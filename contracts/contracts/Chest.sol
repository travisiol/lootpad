// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPonsCurve, IPonsFeeEscrow} from "./interfaces/IPonsV2.sol";

/// The one thing a chest reads back from the router: where the pad's share goes.
interface ILootpadTreasury {
    function treasury() external view returns (address);
}

/**
 * One per launch. Pons pays the token's creator fees to this contract — it
 * is registered as the creator-fee recipient in the launch transaction —
 * and, when the creator chose a lock, Pons delivers the creator's first buy
 * here too. What the chest holds and what it does with it is fixed at
 * deployment. There is no admin and no override; the router names the
 * token and the curve once, in the launch transaction, and never again.
 *
 * The allocation — the creator's first buy — unlocks linearly from launch
 * over `lockDuration`. Anyone can call `unlock()`; it always pays the
 * creator. Without a lock the first buy went straight to the creator's
 * wallet and the chest holds no allocation at all.
 *
 * The loot — creator fees — comes out on every `open()`, which anyone can
 * call, and is split by rules fixed here:
 *
 *   openerBps  to whoever opened the chest (the key: a chest opens itself
 *              because opening pays),
 *   padBps     to the pad's treasury,
 *   burnBps    of the rest is bought back on the curve and sent to the
 *              dead address, one slice per hour so an open call cannot be
 *              sandwiched at a profit (see `_burn`),
 *   the rest   to the creator.
 *
 * The burn rule lives on the curve: once the curve has graduated the chest
 * cannot buy there, so from the first opening that sees graduation the
 * burn share is zero and whatever burn loot was still waiting is sent to
 * the dead address as ETH. It never reaches the creator.
 */
contract Chest is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// One burn spends at most this share of the curve's quote reserve
    /// (virtual liquidity included) …
    uint16 public constant BURN_SLICE_BPS = 200;
    /// … and burns are at least this far apart. Moving the price by p costs
    /// an attacker about 2% × p × reserves in trade fees and wins at most
    /// p × slice, so a slice under 2% of reserves cannot be sandwiched at a
    /// profit — whatever the slippage floor, which is why there is none.
    uint64 public constant BURN_INTERVAL = 1 hours;

    /// The router this chest was created for: the only address allowed to
    /// arm it, and where the pad's treasury address is read from.
    address public immutable router;
    IPonsFeeEscrow public immutable escrow;
    uint64 public immutable launchedAt;
    /// How long the allocation takes to unlock. Zero: no lock, no allocation.
    uint64 public immutable lockDuration;
    /// Share of the creator's loot bought back and burned while on the curve.
    uint16 public immutable burnBps;
    /// The pad's share of every opening. Fixed here so the router's owner
    /// cannot change it for a chest that already exists.
    uint16 public immutable padBps;
    /// The opener's share of every opening.
    uint16 public immutable openerBps;

    address public creator;
    address public pendingCreator;
    IERC20 public token;
    IPonsCurve public curve;

    /// Tokens delivered by the launch, recorded when the router arms the chest.
    uint256 public allocation;
    /// Allocation paid out to the creator so far.
    uint256 public unlocked;
    /// Loot earmarked for burning, waiting for its slice.
    uint256 public burnReserve;
    uint64 public lastBurnAt;
    /// Graduation as first observed here. Ends the burn rule.
    uint64 public graduatedAt;

    /// Every wei of loot that ever came out of the escrow into this chest.
    uint256 public totalLoot;
    uint256 public totalToCreator;
    uint256 public totalToPad;
    uint256 public totalToOpeners;
    /// Wei spent on buybacks, plus wei burned outright after graduation.
    uint256 public totalBurnedEth;
    uint256 public tokensBurned;
    uint32 public openings;

    struct Status {
        bool armed;
        bool graduated;
        /// Graduation as the curve reports it right now.
        bool graduatedLive;
        uint64 launchedAt;
        uint64 lockEnd;
        uint256 allocation;
        uint256 unlocked;
        /// Unlocked and not yet paid out.
        uint256 unlockable;
        /// Still behind the schedule.
        uint256 locked;
        /// Creator fees waiting in Pons' escrow, not yet pulled here.
        uint256 pending;
        /// Fresh loot the next opening would split: escrow + balance, less the burn reserve.
        uint256 lootable;
        uint256 burnReserve;
        /// What the next burn slice would spend, and when it can happen.
        uint256 burnable;
        uint64 nextBurnAt;
        uint256 totalLoot;
        uint256 totalToCreator;
        uint256 totalToPad;
        uint256 totalToOpeners;
        uint256 totalBurnedEth;
        uint256 tokensBurned;
        uint32 openings;
    }

    event Armed(address indexed token, address indexed curve, uint256 allocation);
    event Received(uint256 amount);
    event Opened(
        address indexed opener,
        uint256 loot,
        uint256 toCreator,
        uint256 toPad,
        uint256 toOpener,
        uint256 toBurn
    );
    event Burned(uint256 spent, uint256 tokens);
    event BurnedAsEth(uint256 amount);
    event Unlocked(address indexed to, uint256 amount);
    event GraduationSeen(uint64 at);
    event CreatorProposed(address indexed current, address indexed proposed);
    event CreatorTransferred(address indexed previous, address indexed current);

    error OnlyRouter();
    error OnlyCreator();
    error OnlyPendingCreator();
    error AlreadyArmed();
    error NotArmed();
    error ZeroAddress();
    error BadSplit();
    error NothingToOpen();
    error NothingToUnlock();
    error TransferFailed();

    constructor(
        address router_,
        address creator_,
        IPonsFeeEscrow escrow_,
        uint64 lockDuration_,
        uint16 burnBps_,
        uint16 padBps_,
        uint16 openerBps_
    ) {
        if (router_ == address(0) || creator_ == address(0) || address(escrow_) == address(0)) {
            revert ZeroAddress();
        }
        if (burnBps_ > BPS || uint256(padBps_) + openerBps_ > BPS) revert BadSplit();
        router = router_;
        creator = creator_;
        escrow = escrow_;
        launchedAt = uint64(block.timestamp);
        lockDuration = lockDuration_;
        burnBps = burnBps_;
        padBps = padBps_;
        openerBps = openerBps_;
    }

    /// Called once by the router, in the launch transaction, after Pons has
    /// delivered the first buy here (when there is a lock).
    function arm(IERC20 token_, IPonsCurve curve_) external {
        if (msg.sender != router) revert OnlyRouter();
        if (address(curve) != address(0)) revert AlreadyArmed();
        if (address(token_) == address(0) || address(curve_) == address(0)) revert ZeroAddress();
        token = token_;
        curve = curve_;
        if (lockDuration > 0) allocation = token_.balanceOf(address(this));
        emit Armed(address(token_), address(curve_), allocation);
    }

    /// The escrow pays in native ETH. Anything else that lands here is loot too.
    receive() external payable {
        emit Received(msg.value);
    }

    // ───────────────────────────────────────────── allocation ──

    function lockEnd() public view returns (uint64) {
        return lockDuration == 0 ? 0 : launchedAt + lockDuration;
    }

    /// Allocation unlocked by `timestamp`, paid out or not.
    function vestedAmount(uint64 timestamp) public view returns (uint256) {
        if (lockDuration == 0 || timestamp < launchedAt) return 0;
        if (timestamp >= launchedAt + lockDuration) return allocation;
        return (allocation * (timestamp - launchedAt)) / lockDuration;
    }

    /// Unlocked and not yet paid out.
    function unlockable() public view returns (uint256) {
        return vestedAmount(uint64(block.timestamp)) - unlocked;
    }

    /// Still behind the schedule.
    function locked() public view returns (uint256) {
        return allocation - vestedAmount(uint64(block.timestamp));
    }

    /// Pays the creator whatever the schedule has unlocked. Anyone.
    function unlock() external nonReentrant returns (uint256 amount) {
        if (address(curve) == address(0)) revert NotArmed();
        amount = unlockable();
        if (amount == 0) revert NothingToUnlock();
        unlocked += amount;
        token.safeTransfer(creator, amount);
        emit Unlocked(creator, amount);
    }

    // ───────────────────────────────────────────── loot ──

    /// Creator fees waiting in Pons' escrow, not yet pulled here.
    function pending() public view returns (uint256) {
        return escrow.balanceOf(address(this));
    }

    /// Fresh loot the next opening would split.
    function lootable() public view returns (uint256) {
        return pending() + address(this).balance - burnReserve;
    }

    /// What the next burn slice would spend: the reserve, capped at
    /// BURN_SLICE_BPS of the curve's quote reserve while on the curve.
    function burnable() public view returns (uint256) {
        if (address(curve) == address(0) || burnReserve == 0) return 0;
        if (graduatedAt != 0) return burnReserve;
        (uint256 quote, ) = curve.getReserves();
        uint256 cap = (quote * BURN_SLICE_BPS) / BPS;
        return burnReserve < cap ? burnReserve : cap;
    }

    /// `burnable()` once the interval has passed too — what `open()` would
    /// actually burn right now.
    function burnDue() public view returns (uint256) {
        if (graduatedAt == 0 && lastBurnAt != 0 && block.timestamp < lastBurnAt + BURN_INTERVAL) return 0;
        return burnable();
    }

    function status() external view returns (Status memory s) {
        s.armed = address(curve) != address(0);
        s.graduated = graduatedAt != 0;
        s.graduatedLive = s.armed && (s.graduated || curve.graduated());
        s.launchedAt = launchedAt;
        s.lockEnd = lockEnd();
        s.allocation = allocation;
        s.unlocked = unlocked;
        s.unlockable = unlockable();
        s.locked = locked();
        s.pending = pending();
        s.lootable = lootable();
        s.burnReserve = burnReserve;
        s.burnable = burnable();
        s.nextBurnAt = lastBurnAt == 0 ? 0 : lastBurnAt + BURN_INTERVAL;
        s.totalLoot = totalLoot;
        s.totalToCreator = totalToCreator;
        s.totalToPad = totalToPad;
        s.totalToOpeners = totalToOpeners;
        s.totalBurnedEth = totalBurnedEth;
        s.tokensBurned = tokensBurned;
        s.openings = openings;
    }

    /// Records graduation the first time the curve reports it. Anyone.
    function checkpoint() public returns (bool) {
        if (graduatedAt != 0) return true;
        if (address(curve) == address(0)) return false;
        if (!curve.graduated()) return false;
        graduatedAt = uint64(block.timestamp);
        emit GraduationSeen(graduatedAt);
        return true;
    }

    /**
     * Opens the chest: pulls the creator fees from Pons' escrow, splits the
     * fresh loot by the rules, pays everyone, then burns a slice if one is
     * due. Anyone can call. The opener's share goes to `opener` — the
     * caller names it so the router can pass its own caller through; the
     * zero address means the caller.
     */
    function open(address opener)
        external
        nonReentrant
        returns (uint256 loot, uint256 toCreator, uint256 toPad, uint256 toOpener, uint256 toBurn)
    {
        if (address(curve) == address(0)) revert NotArmed();
        if (opener == address(0)) opener = msg.sender;
        if (escrow.balanceOf(address(this)) > 0) escrow.claim();
        checkpoint();

        loot = address(this).balance - burnReserve;
        if (loot == 0 && burnDue() == 0) revert NothingToOpen();

        if (loot > 0) {
            toOpener = (loot * openerBps) / BPS;
            toPad = (loot * padBps) / BPS;
            uint256 rest = loot - toOpener - toPad;
            toBurn = graduatedAt == 0 ? (rest * burnBps) / BPS : 0;
            toCreator = rest - toBurn;

            burnReserve += toBurn;
            totalLoot += loot;
            totalToCreator += toCreator;
            totalToPad += toPad;
            totalToOpeners += toOpener;
            openings += 1;

            _pay(opener, toOpener);
            if (toPad > 0) _pay(ILootpadTreasury(router).treasury(), toPad);
            _pay(creator, toCreator);
            emit Opened(opener, loot, toCreator, toPad, toOpener, toBurn);
        }

        _burn();
    }

    /// One slice of the burn reserve: bought back on the curve and sent to
    /// the dead address, or — once the curve has graduated and can no
    /// longer be bought from — the whole reserve burned as ETH.
    function _burn() private {
        if (burnReserve == 0) return;
        if (graduatedAt != 0) {
            uint256 amount = burnReserve;
            burnReserve = 0;
            totalBurnedEth += amount;
            _pay(DEAD, amount);
            emit BurnedAsEth(amount);
            return;
        }
        uint256 spend = burnDue();
        if (spend == 0) return;
        lastBurnAt = uint64(block.timestamp);
        burnReserve -= spend;
        totalBurnedEth += spend;
        // Buy to the chest, then move exactly what was bought: the chest may
        // also be holding the creator's locked allocation.
        uint256 before = token.balanceOf(address(this));
        curve.buy{value: spend}(spend, 0, address(this));
        uint256 bought = token.balanceOf(address(this)) - before;
        token.safeTransfer(DEAD, bought);
        tokensBurned += bought;
        emit Burned(spend, bought);
    }

    // ───────────────────────────────────────────── creator ──

    /// Two-step hand-over of the creator role (a rotated wallet, a multisig).
    /// Changes who is paid, never when or how much.
    function proposeCreator(address proposed) external {
        if (msg.sender != creator) revert OnlyCreator();
        pendingCreator = proposed;
        emit CreatorProposed(creator, proposed);
    }

    function acceptCreator() external {
        if (msg.sender != pendingCreator || msg.sender == address(0)) revert OnlyPendingCreator();
        address previous = creator;
        creator = msg.sender;
        pendingCreator = address(0);
        emit CreatorTransferred(previous, msg.sender);
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
