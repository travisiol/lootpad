// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPonsFactoryV2, IPonsLaunchForwarder, IPonsFeeEscrow, IPonsCurve} from "./interfaces/IPonsV2.sol";
import {Chest} from "./Chest.sol";
import {ChestFactory} from "./ChestFactory.sol";

/**
 * Lootpad — every launch is a chest.
 *
 * `launch()` deploys one Chest for the creator and launches the token on
 * Pons V2 with the chest wired in twice:
 *
 *   - as the creator-fee recipient, so every creator fee the token earns
 *     lands in the chest and comes out on `open()`, split by the rules the
 *     creator fixed at launch (opener's key, pad's share, burn share, the
 *     rest to the creator);
 *   - as the recipient of the creator's first buy when the creator chose a
 *     lock, so the allocation sits in the chest and unlocks on a public
 *     schedule instead of landing in a wallet.
 *
 * With a lock the creator's own wallet is deliberately NOT exempted from
 * the snipe tax — the only exempt buyer is the chest — so a second wallet
 * pays what everyone pays. Without a lock the first buy goes to the
 * creator's wallet, which Pons exempts as it would on any launch.
 *
 * The router never holds loot or tokens. The pad's share is taken by the
 * chests from every opening; there is no other revenue and no launch fee
 * beyond Pons' own unless the owner sets one.
 */
contract LootpadRouter is Ownable2Step, ReentrancyGuard {
    uint16 public constant BPS = 10_000;
    /// The pad's share of every opening: 10%.
    uint16 public constant PAD_BPS = 1_000;
    /// The opener's share of every opening: 1%. The key.
    uint16 public constant OPENER_BPS = 100;
    /// Bounds for the allocation lock the creator picks (or zero: no lock).
    uint64 public constant MIN_LOCK = 1 days;
    uint64 public constant MAX_LOCK = 365 days;
    /// Pons launch config used for every launch (the only one deployed today).
    uint256 public constant LAUNCH_CONFIG_ID = 0;
    /// Launches are paired with native ETH.
    address public constant NATIVE_PAIR = address(0);

    IPonsFactoryV2 public immutable ponsFactory;
    IPonsLaunchForwarder public immutable ponsForwarder;
    IPonsFeeEscrow public immutable feeEscrow;
    /// Deploys the chests; kept separate so the router stays under the
    /// contract size limit.
    ChestFactory public immutable chestFactory;

    address public treasury;
    /// Charged on top of the Pons launch fee. Zero: the pad earns only when
    /// a chest opens.
    uint256 public padLaunchFee;
    bool public paused;

    struct ChestParams {
        string name;
        string symbol;
        /// ipfs:// or https:// — stored here so the site can show it without
        /// an indexer.
        string logo;
        string description;
        string x;
        string telegram;
        string website;
        uint16 creatorTaxBps;
        /// CREATE2 salt for the token address. Any value; use a fresh one.
        bytes32 salt;
        /// Wei to spend on tokens for the creator in the same transaction:
        /// the allocation. Delivered to the chest when there is a lock.
        uint256 firstBuy;
        /// Slippage floor for that buy (0 accepts any fill).
        uint256 minTokensOut;
        /// How long the allocation takes to unlock. Zero: no lock.
        uint64 lockDuration;
        /// Share of the creator's loot bought back and burned while on the curve.
        uint16 burnBps;
    }

    struct ChestInfo {
        address token;
        address curve;
        address creator;
        address chest;
        uint16 creatorTaxBps;
        uint16 burnBps;
        uint256 firstBuy;
        uint64 lockDuration;
        uint64 launchedAt;
        uint64 launchBlock;
        string name;
        string symbol;
        string logo;
        string description;
    }

    address[] private _tokens;
    mapping(address token => ChestInfo) private _info;
    mapping(address creator => address[] tokens) private _byCreator;

    event Launched(
        address indexed token,
        address indexed curve,
        address indexed creator,
        address chest,
        uint256 firstBuy,
        uint64 lockDuration,
        uint16 burnBps,
        uint16 creatorTaxBps
    );
    event TreasuryUpdated(address indexed treasury);
    event PadLaunchFeeUpdated(uint256 fee);
    event PausedUpdated(bool paused);

    error ZeroAddress();
    error Paused();
    error LaunchClosed();
    error WrongValue(uint256 expected, uint256 sent);
    error EmptyName();
    error EmptySymbol();
    error TaxTooHigh(uint256 max);
    error LockOutOfRange(uint64 min, uint64 max);
    error LockWithoutAllocation();
    error BurnOutOfRange(uint16 max);
    error UnknownToken();
    error TransferFailed();

    constructor(IPonsFactoryV2 factory_, ChestFactory chestFactory_, address treasury_, address owner_)
        Ownable(owner_)
    {
        if (address(factory_) == address(0) || address(chestFactory_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        ponsFactory = factory_;
        chestFactory = chestFactory_;
        feeEscrow = IPonsFeeEscrow(factory_.feeEscrow());
        ponsForwarder = IPonsLaunchForwarder(factory_.launchForwarder());
        if (address(feeEscrow) == address(0) || address(ponsForwarder) == address(0)) {
            revert ZeroAddress();
        }
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    // ───────────────────────────────────────────── launch ──

    /**
     * Fill the chest and open it: launch on Pons through the pad. Send
     * exactly `totalLaunchFee() + params.firstBuy` wei.
     */
    function launch(ChestParams calldata params)
        external
        payable
        nonReentrant
        returns (address token, address curve, address chest)
    {
        if (paused) revert Paused();
        if (!canLaunchHere()) revert LaunchClosed();
        _validate(params);

        uint256 ponsFee = ponsFactory.launchFee();
        uint256 expected = ponsFee + padLaunchFee + params.firstBuy;
        if (msg.value != expected) revert WrongValue(expected, msg.value);

        chest = address(
            chestFactory.createChest(msg.sender, feeEscrow, params.lockDuration, params.burnBps, PAD_BPS, OPENER_BPS)
        );

        (token, curve) = _launchOnPons(params, chest, ponsFee);
        Chest(payable(chest)).arm(IERC20(token), IPonsCurve(curve));

        _record(params, token, curve, chest);

        if (padLaunchFee > 0) {
            (bool ok, ) = treasury.call{value: padLaunchFee}("");
            if (!ok) revert TransferFailed();
        }

        emit Launched(token, curve, msg.sender, chest, params.firstBuy, params.lockDuration, params.burnBps, params.creatorTaxBps);
    }

    function _validate(ChestParams calldata params) private view {
        if (bytes(params.name).length == 0) revert EmptyName();
        if (bytes(params.symbol).length == 0) revert EmptySymbol();
        uint256 maxTax = ponsFactory.maxCreatorTaxBps();
        if (params.creatorTaxBps > maxTax) revert TaxTooHigh(maxTax);
        if (params.burnBps > BPS) revert BurnOutOfRange(BPS);
        if (params.lockDuration != 0) {
            if (params.firstBuy == 0) revert LockWithoutAllocation();
            if (params.lockDuration < MIN_LOCK || params.lockDuration > MAX_LOCK) revert LockOutOfRange(MIN_LOCK, MAX_LOCK);
        }
    }

    /// The factory exempts the deployer (this router) and the fee recipient
    /// (the chest) from the snipe tax itself, and the forwarder exempts the
    /// buy recipient. Nobody else, so the exempt list is always empty: with
    /// a lock the buy recipient is the chest and the creator's wallet pays
    /// the tax like everyone; without one it is the creator's wallet.
    function _launchOnPons(ChestParams calldata params, address chest, uint256 ponsFee)
        private
        returns (address token, address curve)
    {
        IPonsFactoryV2.LaunchParams memory ponsParams = IPonsFactoryV2.LaunchParams({
            name: params.name,
            symbol: params.symbol,
            logo: params.logo,
            description: params.description,
            socials: IPonsFactoryV2.Socials({
                x: params.x,
                telegram: params.telegram,
                website: params.website,
                discord: "",
                extra: ""
            }),
            creatorFeeRecipient: chest,
            creatorTaxBps: params.creatorTaxBps,
            buybackEnabled: true,
            economicsHash: ponsFactory.previewLaunchEconomics(LAUNCH_CONFIG_ID, NATIVE_PAIR),
            salt: params.salt
        });
        address[] memory exempt = new address[](0);

        if (params.firstBuy > 0) {
            address buyRecipient = params.lockDuration > 0 ? chest : msg.sender;
            (token, curve) = ponsForwarder.launchAndBuy{value: ponsFee + params.firstBuy}(
                ponsParams,
                LAUNCH_CONFIG_ID,
                NATIVE_PAIR,
                params.firstBuy,
                params.minTokensOut,
                buyRecipient,
                exempt
            );
        } else {
            (token, curve) = ponsFactory.launchToken{value: ponsFee}(ponsParams, LAUNCH_CONFIG_ID, NATIVE_PAIR, exempt);
        }
    }

    function _record(ChestParams calldata params, address token, address curve, address chest) private {
        _tokens.push(token);
        _byCreator[msg.sender].push(token);
        ChestInfo storage info = _info[token];
        info.token = token;
        info.curve = curve;
        info.creator = msg.sender;
        info.chest = chest;
        info.creatorTaxBps = params.creatorTaxBps;
        info.burnBps = params.burnBps;
        info.firstBuy = params.firstBuy;
        info.lockDuration = params.lockDuration;
        info.launchedAt = uint64(block.timestamp);
        info.launchBlock = uint64(block.number);
        info.name = params.name;
        info.symbol = params.symbol;
        info.logo = params.logo;
        info.description = params.description;
    }

    // ───────────────────────────────────────────── chests ──

    /// Opens a chest: pulls its loot and pays it out by the rules. Anyone;
    /// the caller receives the opener's share.
    function open(address token)
        external
        returns (uint256 loot, uint256 toCreator, uint256 toPad, uint256 toOpener, uint256 toBurn)
    {
        return _chestOf(token).open(msg.sender);
    }

    /// Pays the creator whatever allocation the schedule has unlocked. Anyone.
    function unlock(address token) external returns (uint256) {
        return _chestOf(token).unlock();
    }

    /// Records graduation on the chest if the curve reports it. Anyone.
    function checkpoint(address token) external returns (bool) {
        return _chestOf(token).checkpoint();
    }

    /// Everything a chest reports, in one read.
    function status(address token) external view returns (Chest.Status memory) {
        return _chestOf(token).status();
    }

    // ───────────────────────────────────────────── views ──

    /// Pons will accept a launch from this router right now.
    function canLaunchHere() public view returns (bool) {
        return ponsFactory.launchEnabled() && ponsFactory.canLaunch(address(this));
    }

    /// Pons' own launch fee, read live.
    function ponsLaunchFee() public view returns (uint256) {
        return ponsFactory.launchFee();
    }

    /// What `launch()` must be sent, before the first buy.
    function totalLaunchFee() external view returns (uint256) {
        return ponsLaunchFee() + padLaunchFee;
    }

    function chestCount() external view returns (uint256) {
        return _tokens.length;
    }

    function tokenAt(uint256 index) external view returns (address) {
        return _tokens[index];
    }

    /// Newest first. `offset` counts from the newest chest.
    function chests(uint256 offset, uint256 limit) external view returns (ChestInfo[] memory page) {
        uint256 n = _tokens.length;
        if (offset >= n) return page;
        uint256 count = n - offset;
        if (count > limit) count = limit;
        page = new ChestInfo[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = _info[_tokens[n - 1 - offset - i]];
        }
    }

    function chestsOf(address creator) external view returns (address[] memory) {
        return _byCreator[creator];
    }

    function infoOf(address token) external view returns (ChestInfo memory info) {
        info = _info[token];
        if (info.token == address(0)) revert UnknownToken();
    }

    // ───────────────────────────────────────────── admin ──

    /// Where the pad's share goes. Only ever affects the pad's own 10%.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setPadLaunchFee(uint256 fee) external onlyOwner {
        padLaunchFee = fee;
        emit PadLaunchFeeUpdated(fee);
    }

    /// Stops new launches. Existing chests have no pause.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedUpdated(paused_);
    }

    /// ETH that ended up here by mistake goes to the treasury. The router is
    /// never meant to hold a balance.
    function sweep() external onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        (bool ok, ) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// Refunds from the curve or factory land here.
    receive() external payable {}

    function _chestOf(address token) private view returns (Chest chest) {
        address c = _info[token].chest;
        if (c == address(0)) revert UnknownToken();
        chest = Chest(payable(c));
    }
}
