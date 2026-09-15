import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const PONS_FEE = ethers.parseEther("0.0005");
const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const BPS = 10_000n;
const DEAD = "0x000000000000000000000000000000000000dEaD";

function params(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Loot",
    symbol: "LOOT",
    logo: "ipfs://bafkreiloot",
    description: "Every launch is a chest.",
    x: "https://x.com/lootpad",
    telegram: "",
    website: "https://lootpad.example",
    creatorTaxBps: 0,
    salt: ethers.hexlify(ethers.randomBytes(32)),
    firstBuy: 0n,
    minTokensOut: 0n,
    lockDuration: 0n,
    burnBps: 0,
    ...overrides,
  };
}

/**
 * Router + chest factory in front of the mock Pons: factory, escrow, one
 * constant-product curve per launch.
 *
 *   deployer  owns the router
 *   treasury  receives the pad's 10%
 *   creator   launches
 *   trader    buys on the curve (fees accrue)
 *   opener    opens chests and unlocks allocations
 */
async function deployFixture() {
  const [deployer, treasury, creator, trader, opener, ponsSink] = await ethers.getSigners();
  const factory = await (await ethers.getContractFactory("MockPonsFactory")).deploy(ponsSink.address);
  const factoryAddress = await factory.getAddress();
  const chestFactory = await (await ethers.getContractFactory("ChestFactory")).deploy();
  const router = await (await ethers.getContractFactory("LootpadRouter")).deploy(
    factoryAddress,
    await chestFactory.getAddress(),
    treasury.address,
    deployer.address,
  );
  const routerAddress = await router.getAddress();
  const escrow = await ethers.getContractAt("MockFeeEscrow", await factory.feeEscrow());
  return { deployer, treasury, creator, trader, opener, ponsSink, factory, chestFactory, router, routerAddress, escrow };
}

type Fx = Awaited<ReturnType<typeof deployFixture>>;

async function launchOne(fx: Fx, overrides: Partial<Record<string, unknown>> = {}) {
  const p = params(overrides);
  const firstBuy = p.firstBuy as bigint;
  const tx = await fx.router.connect(fx.creator).launch(p, { value: PONS_FEE + firstBuy });
  const receipt = await tx.wait();
  const parsed = receipt!.logs
    .map((l) => {
      try {
        return fx.router.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "Launched")!;
  const [token, curve, , chestAddress] = parsed.args;
  const chest = await ethers.getContractAt("Chest", chestAddress as string);
  const curveC = await ethers.getContractAt("MockCurve", curve as string);
  const erc20 = await ethers.getContractAt("MockLaunchedToken", token as string);
  return {
    token: token as string,
    curve: curve as string,
    chestAddress: chestAddress as string,
    chest,
    curveC,
    erc20,
    p,
    launchedAt: (await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp,
  };
}

async function buy(fx: Fx, curve: string, eth: string) {
  const c = await ethers.getContractAt("MockCurve", curve);
  const value = ethers.parseEther(eth);
  await (await c.connect(fx.trader).buy(value, 0, fx.trader.address, { value })).wait();
}

describe("LootpadRouter", () => {
  describe("constructor", () => {
    it("wires Pons, the chest factory, the treasury and the owner", async () => {
      const { router, factory, chestFactory, treasury, deployer } = await loadFixture(deployFixture);
      expect(await router.ponsFactory()).to.equal(await factory.getAddress());
      expect(await router.ponsForwarder()).to.equal(await factory.launchForwarder());
      expect(await router.feeEscrow()).to.equal(await factory.feeEscrow());
      expect(await router.chestFactory()).to.equal(await chestFactory.getAddress());
      expect(await router.treasury()).to.equal(treasury.address);
      expect(await router.owner()).to.equal(deployer.address);
      expect(await router.PAD_BPS()).to.equal(1000);
      expect(await router.OPENER_BPS()).to.equal(100);
      expect(await router.MIN_LOCK()).to.equal(DAY);
      expect(await router.MAX_LOCK()).to.equal(365 * DAY);
      expect(await router.padLaunchFee()).to.equal(0);
      expect(await router.canLaunchHere()).to.equal(true);
    });

    it("rejects zero addresses", async () => {
      const { factory, chestFactory, treasury, deployer } = await loadFixture(deployFixture);
      const Router = await ethers.getContractFactory("LootpadRouter");
      const f = await factory.getAddress();
      const cf = await chestFactory.getAddress();
      await expect(Router.deploy(ethers.ZeroAddress, cf, treasury.address, deployer.address)).to.be.revertedWithCustomError(Router, "ZeroAddress");
      await expect(Router.deploy(f, ethers.ZeroAddress, treasury.address, deployer.address)).to.be.revertedWithCustomError(Router, "ZeroAddress");
      await expect(Router.deploy(f, cf, ethers.ZeroAddress, deployer.address)).to.be.revertedWithCustomError(Router, "ZeroAddress");
    });
  });

  describe("launch", () => {
    it("launches without a first buy: chest = fee recipient, nothing held", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx);
      const last = await fx.factory.lastParams();
      expect(last.creatorFeeRecipient).to.equal(l.chestAddress);
      expect(last.buybackEnabled).to.equal(true);
      expect(await fx.factory.lastLauncher()).to.equal(fx.routerAddress);
      expect(await fx.factory.lastExemptList()).to.deep.equal([]);
      expect(await l.chest.allocation()).to.equal(0);
      expect(await l.chest.token()).to.equal(l.token);
      expect(await l.chest.curve()).to.equal(l.curve);
      expect(await l.chest.creator()).to.equal(fx.creator.address);
      expect(await l.chest.router()).to.equal(fx.routerAddress);
      expect(await l.chest.padBps()).to.equal(1000);
      expect(await l.chest.openerBps()).to.equal(100);
      expect(await fx.router.chestCount()).to.equal(1);
    });

    it("with a first buy and no lock: tokens go to the creator's wallet, which Pons exempts", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx, { firstBuy: ethers.parseEther("0.05") });
      const forwarder = await ethers.getContractAt("MockLaunchForwarder", await fx.factory.launchForwarder());
      expect(await forwarder.lastBuyRecipient()).to.equal(fx.creator.address);
      expect(await l.erc20.balanceOf(fx.creator.address)).to.be.gt(0);
      expect(await l.erc20.balanceOf(l.chestAddress)).to.equal(0);
      expect(await l.chest.allocation()).to.equal(0);
      expect(await l.curveC.snipeTaxExempt(fx.creator.address)).to.equal(true);
    });

    it("with a lock: the allocation lands in the chest and the creator's wallet is not exempt", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx, { firstBuy: ethers.parseEther("0.05"), lockDuration: BigInt(30 * DAY) });
      const forwarder = await ethers.getContractAt("MockLaunchForwarder", await fx.factory.launchForwarder());
      expect(await forwarder.lastBuyRecipient()).to.equal(l.chestAddress);
      const held = await l.erc20.balanceOf(l.chestAddress);
      expect(held).to.be.gt(0);
      expect(await l.chest.allocation()).to.equal(held);
      expect(await l.erc20.balanceOf(fx.creator.address)).to.equal(0);
      expect(await l.curveC.snipeTaxExempt(l.chestAddress)).to.equal(true);
      expect(await l.curveC.snipeTaxExempt(fx.creator.address)).to.equal(false);
      expect(await l.chest.lockDuration()).to.equal(30 * DAY);
      expect(await l.chest.lockEnd()).to.equal(l.launchedAt + 30 * DAY);
      const info = await fx.router.infoOf(l.token);
      expect(info.chest).to.equal(l.chestAddress);
      expect(info.firstBuy).to.equal(ethers.parseEther("0.05"));
      expect(info.lockDuration).to.equal(30 * DAY);
    });

    it("records the rules in the registry and lists newest first", async () => {
      const fx = await loadFixture(deployFixture);
      const a = await launchOne(fx, { name: "Alpha", symbol: "A", burnBps: 2500, creatorTaxBps: 300 });
      const b = await launchOne(fx, { name: "Beta", symbol: "B", firstBuy: ethers.parseEther("0.01"), lockDuration: BigInt(7 * DAY) });
      const page = await fx.router.chests(0, 10);
      expect(page.map((c) => c.token)).to.deep.equal([b.token, a.token]);
      expect(page[1].burnBps).to.equal(2500);
      expect(page[1].creatorTaxBps).to.equal(300);
      expect(page[1].name).to.equal("Alpha");
      expect(page[1].logo).to.equal("ipfs://bafkreiloot");
      expect(await fx.router.chestsOf(fx.creator.address)).to.deep.equal([a.token, b.token]);
      expect(await fx.router.tokenAt(0)).to.equal(a.token);
      expect((await fx.router.chests(1, 10)).length).to.equal(1);
      expect((await fx.router.chests(5, 10)).length).to.equal(0);
      await expect(fx.router.infoOf(fx.creator.address)).to.be.revertedWithCustomError(fx.router, "UnknownToken");
    });

    it("validates the rules", async () => {
      const fx = await loadFixture(deployFixture);
      const r = fx.router.connect(fx.creator);
      await expect(r.launch(params({ name: "" }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "EmptyName");
      await expect(r.launch(params({ symbol: "" }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "EmptySymbol");
      await expect(r.launch(params({ creatorTaxBps: 1001 }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "TaxTooHigh");
      await expect(r.launch(params({ burnBps: 10_001 }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "BurnOutOfRange");
      await expect(r.launch(params({ lockDuration: BigInt(7 * DAY) }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "LockWithoutAllocation");
      await expect(r.launch(params({ firstBuy: 1n, lockDuration: BigInt(HOUR) }), { value: PONS_FEE + 1n })).to.be.revertedWithCustomError(fx.router, "LockOutOfRange");
      await expect(r.launch(params({ firstBuy: 1n, lockDuration: BigInt(366 * DAY) }), { value: PONS_FEE + 1n })).to.be.revertedWithCustomError(fx.router, "LockOutOfRange");
      await expect(r.launch(params(), { value: PONS_FEE - 1n })).to.be.revertedWithCustomError(fx.router, "WrongValue").withArgs(PONS_FEE, PONS_FEE - 1n);
      await expect(r.launch(params({ firstBuy: ethers.parseEther("0.1") }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "WrongValue");
    });

    it("respects the pause and Pons' own gate", async () => {
      const fx = await loadFixture(deployFixture);
      await fx.router.setPaused(true);
      await expect(fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "Paused");
      await fx.router.setPaused(false);
      await fx.factory.setLaunchEnabled(false);
      expect(await fx.router.canLaunchHere()).to.equal(false);
      await expect(fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "LaunchClosed");
    });

    it("charges an optional pad launch fee to the treasury", async () => {
      const fx = await loadFixture(deployFixture);
      const padFee = ethers.parseEther("0.001");
      await fx.router.setPadLaunchFee(padFee);
      expect(await fx.router.totalLaunchFee()).to.equal(PONS_FEE + padFee);
      const before = await ethers.provider.getBalance(fx.treasury.address);
      await fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE + padFee });
      expect((await ethers.provider.getBalance(fx.treasury.address)) - before).to.equal(padFee);
    });
  });

  describe("Chest — opening", () => {
    it("splits fresh loot: 1% opener, 10% pad, burn share reserved, rest to the creator", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx, { burnBps: 5000 });
      await buy(fx, l.curve, "1");
      const loot = await fx.escrow.balanceOf(l.chestAddress);
      expect(loot).to.equal(ethers.parseEther("0.01")); // 1% fee on 1 ETH
      const s0 = await l.chest.status();
      expect(s0.pending).to.equal(loot);
      expect(s0.lootable).to.equal(loot);

      const toOpener = (loot * 100n) / BPS;
      const toPad = (loot * 1000n) / BPS;
      const rest = loot - toOpener - toPad;
      const toBurn = (rest * 5000n) / BPS;
      const toCreator = rest - toBurn;

      const creatorBefore = await ethers.provider.getBalance(fx.creator.address);
      const padBefore = await ethers.provider.getBalance(fx.treasury.address);
      const openerBefore = await ethers.provider.getBalance(fx.opener.address);
      const tx = await fx.router.connect(fx.opener).open(l.token);
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;

      await expect(tx).to.emit(l.chest, "Opened").withArgs(fx.opener.address, loot, toCreator, toPad, toOpener, toBurn);
      expect((await ethers.provider.getBalance(fx.creator.address)) - creatorBefore).to.equal(toCreator);
      expect((await ethers.provider.getBalance(fx.treasury.address)) - padBefore).to.equal(toPad);
      expect((await ethers.provider.getBalance(fx.opener.address)) - openerBefore + gas).to.equal(toOpener);
      // The burn slice ran in the same call: the mock curve is deep, so the whole reserve went.
      await expect(tx).to.emit(l.chest, "Burned");
      expect(await l.chest.burnReserve()).to.equal(0);
      expect(await l.chest.totalBurnedEth()).to.equal(toBurn);
      expect(await l.erc20.balanceOf(DEAD)).to.be.gt(0);
      expect(await l.chest.tokensBurned()).to.equal(await l.erc20.balanceOf(DEAD));
      const s = await l.chest.status();
      expect(s.totalLoot).to.equal(loot);
      expect(s.totalToCreator).to.equal(toCreator);
      expect(s.totalToPad).to.equal(toPad);
      expect(s.totalToOpeners).to.equal(toOpener);
      expect(s.openings).to.equal(1);
      // The buyback is itself a trade on the mock curve: its 1% fee is
      // credited straight back to this chest (on the real curve it waits
      // for Pons' sweep). That is the only loot left.
      expect(s.pending).to.equal(toBurn / 100n);
      expect(s.lootable).to.equal(s.pending);
    });

    it("refuses to open an empty chest", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx);
      await expect(fx.router.connect(fx.opener).open(l.token)).to.be.revertedWithCustomError(l.chest, "NothingToOpen");
      await expect(fx.router.open(fx.opener.address)).to.be.revertedWithCustomError(fx.router, "UnknownToken");
    });

    it("burns in slices: at most 2% of the quote reserve per hour, the rest waits", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx, { burnBps: 10_000 });
      // A big pile of loot relative to the curve: send it straight to the chest.
      await fx.trader.sendTransaction({ to: l.chestAddress, value: ethers.parseEther("1") });
      const [quote] = await l.curveC.getReserves();
      const cap = (quote * 200n) / BPS;
      const loot = ethers.parseEther("1");
      const rest = loot - (loot * 100n) / BPS - (loot * 1000n) / BPS;
      expect(rest).to.be.gt(cap);

      const tx = await fx.router.connect(fx.opener).open(l.token);
      await expect(tx).to.emit(l.chest, "Burned").withArgs(cap, await l.erc20.balanceOf(DEAD));
      expect(await l.chest.burnReserve()).to.equal(rest - cap);
      expect(await l.chest.totalBurnedEth()).to.equal(cap);

      // Same hour: the burn is on cooldown. The buyback itself paid a 1% fee
      // back into this chest, so an opening still has that to split — but
      // it must not burn.
      expect(await l.chest.burnDue()).to.equal(0);
      expect(await l.chest.burnable()).to.be.gt(0);
      const reserveBefore = await l.chest.burnReserve();
      await expect(fx.router.connect(fx.opener).open(l.token)).to.not.emit(l.chest, "Burned");
      expect(await l.chest.burnReserve()).to.be.gte(reserveBefore);
      await expect(fx.router.connect(fx.opener).open(l.token)).to.be.revertedWithCustomError(l.chest, "NothingToOpen");

      await time.increase(HOUR + 1);
      const s = await l.chest.status();
      expect(s.burnable).to.equal(await l.chest.burnDue());
      expect(s.nextBurnAt).to.be.lte(await time.latest());
      const before = await l.chest.burnReserve();
      await expect(fx.router.connect(fx.opener).open(l.token)).to.emit(l.chest, "Burned");
      expect(await l.chest.burnReserve()).to.be.lt(before);
      // Only what was bought moved to the dead address; nothing else left the chest.
      expect(await l.erc20.balanceOf(l.chestAddress)).to.equal(0);
    });

    it("never burns the creator's locked allocation", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx, { firstBuy: ethers.parseEther("0.05"), lockDuration: BigInt(30 * DAY), burnBps: 10_000 });
      const allocation = await l.chest.allocation();
      await buy(fx, l.curve, "0.5");
      await fx.router.connect(fx.opener).open(l.token);
      expect(await l.erc20.balanceOf(l.chestAddress)).to.equal(allocation);
      expect(await l.chest.tokensBurned()).to.equal(await l.erc20.balanceOf(DEAD));
      expect(await l.chest.tokensBurned()).to.be.gt(0);
    });

    it("ends the burn rule at graduation: share to zero, leftover reserve burned as ETH", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx, { burnBps: 5000 });
      await fx.trader.sendTransaction({ to: l.chestAddress, value: ethers.parseEther("1") });
      await fx.router.connect(fx.opener).open(l.token);
      const leftover = await l.chest.burnReserve();
      expect(leftover).to.be.gt(0);

      await l.curveC.setGraduated(true);
      expect((await l.chest.status()).graduatedLive).to.equal(true);
      expect((await l.chest.status()).graduated).to.equal(false);
      await buy(fx, l.curve, "0.1").catch(() => undefined); // closed curve; fund the escrow directly instead
      await fx.escrow.credit(l.chestAddress, { value: ethers.parseEther("0.02") });

      const deadBefore = await ethers.provider.getBalance(DEAD);
      const creatorBefore = await ethers.provider.getBalance(fx.creator.address);
      // Everything in the escrow (the 0.02 plus the fee the earlier buyback paid back).
      const loot = await fx.escrow.balanceOf(l.chestAddress);
      const tx = await fx.router.connect(fx.opener).open(l.token);
      await expect(tx).to.emit(l.chest, "GraduationSeen");
      await expect(tx).to.emit(l.chest, "BurnedAsEth").withArgs(leftover);
      const rest = loot - (loot * 100n) / BPS - (loot * 1000n) / BPS;
      await expect(tx).to.emit(l.chest, "Opened").withArgs(fx.opener.address, loot, rest, (loot * 1000n) / BPS, (loot * 100n) / BPS, 0);
      expect((await ethers.provider.getBalance(DEAD)) - deadBefore).to.equal(leftover);
      expect((await ethers.provider.getBalance(fx.creator.address)) - creatorBefore).to.equal(rest);
      expect(await l.chest.burnReserve()).to.equal(0);
      expect(await l.chest.graduatedAt()).to.be.gt(0);
      expect(await fx.router.checkpoint(l.token)).to.not.be.reverted;
    });

    it("opens with no burn rule: 89% to the creator", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx);
      await buy(fx, l.curve, "2");
      const loot = await fx.escrow.balanceOf(l.chestAddress);
      const before = await ethers.provider.getBalance(fx.creator.address);
      await fx.router.connect(fx.opener).open(l.token);
      expect((await ethers.provider.getBalance(fx.creator.address)) - before).to.equal((loot * 8900n) / BPS);
      expect(await l.chest.burnReserve()).to.equal(0);
    });

    it("opened directly, the zero address means the caller and any other address is honoured", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx);
      await buy(fx, l.curve, "1");
      const loot = ethers.parseEther("0.01");
      const openerBefore = await ethers.provider.getBalance(fx.opener.address);
      const tx = await l.chest.connect(fx.trader).open(ethers.ZeroAddress);
      await expect(tx).to.emit(l.chest, "Opened").withArgs(fx.trader.address, loot, (loot * 8900n) / BPS, (loot * 1000n) / BPS, (loot * 100n) / BPS, 0);
      await buy(fx, l.curve, "1");
      await l.chest.connect(fx.trader).open(fx.opener.address);
      expect((await ethers.provider.getBalance(fx.opener.address)) - openerBefore).to.equal((loot * 100n) / BPS);
    });
  });

  describe("Chest — allocation", () => {
    it("unlocks linearly and pays the creator, whoever calls", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx, { firstBuy: ethers.parseEther("0.1"), lockDuration: BigInt(100 * DAY) });
      const allocation = await l.chest.allocation();
      // A block or two after launch only a sliver has vested.
      expect(await l.chest.locked()).to.be.closeTo(allocation, allocation / 100000n);
      expect(await l.chest.unlockable()).to.be.lt(allocation / 100000n);

      await time.increaseTo(l.launchedAt + 25 * DAY);
      const quarter = allocation / 4n;
      expect(await l.chest.unlockable()).to.be.closeTo(quarter, allocation / 100000n);
      await fx.router.connect(fx.opener).unlock(l.token);
      const paid = await l.erc20.balanceOf(fx.creator.address);
      expect(paid).to.be.closeTo(quarter, allocation / 100000n);
      expect(await l.chest.unlocked()).to.equal(paid);

      await time.increaseTo(l.launchedAt + 100 * DAY);
      expect(await l.chest.locked()).to.equal(0);
      await l.chest.connect(fx.opener).unlock();
      expect(await l.erc20.balanceOf(fx.creator.address)).to.equal(allocation);
      expect(await l.erc20.balanceOf(l.chestAddress)).to.equal(0);
      const s = await l.chest.status();
      expect(s.unlocked).to.equal(allocation);
      expect(s.unlockable).to.equal(0);
      expect(s.lockEnd).to.equal(l.launchedAt + 100 * DAY);
    });

    it("has nothing to unlock without a lock", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx, { firstBuy: ethers.parseEther("0.1") });
      expect(await l.chest.vestedAmount(BigInt(l.launchedAt + 400 * DAY))).to.equal(0);
      await expect(l.chest.unlock()).to.be.revertedWithCustomError(l.chest, "NothingToUnlock");
    });
  });

  describe("Chest — guards", () => {
    it("can only be armed once, by its router", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx);
      await expect(l.chest.connect(fx.creator).arm(l.token, l.curve)).to.be.revertedWithCustomError(l.chest, "OnlyRouter");
      const escrow = await fx.factory.feeEscrow();
      const Chest = await ethers.getContractFactory("Chest");
      const loose = await Chest.connect(fx.opener).deploy(fx.opener.address, fx.creator.address, escrow, 0, 0, 1000, 100);
      await expect(loose.connect(fx.opener).arm(l.token, l.curve)).to.not.be.reverted;
      await expect(loose.connect(fx.opener).arm(l.token, l.curve)).to.be.revertedWithCustomError(loose, "AlreadyArmed");
      const bare = await Chest.connect(fx.opener).deploy(fx.opener.address, fx.creator.address, escrow, 0, 0, 1000, 100);
      await expect(bare.open(ethers.ZeroAddress)).to.be.revertedWithCustomError(bare, "NotArmed");
      await expect(bare.unlock()).to.be.revertedWithCustomError(bare, "NotArmed");
      await expect(Chest.deploy(fx.opener.address, fx.creator.address, escrow, 0, 10_001, 1000, 100)).to.be.revertedWithCustomError(Chest, "BadSplit");
      await expect(Chest.deploy(fx.opener.address, fx.creator.address, escrow, 0, 0, 9000, 1001)).to.be.revertedWithCustomError(Chest, "BadSplit");
      await expect(Chest.deploy(ethers.ZeroAddress, fx.creator.address, escrow, 0, 0, 1000, 100)).to.be.revertedWithCustomError(Chest, "ZeroAddress");
    });

    it("hands the creator role over in two steps", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx);
      await expect(l.chest.connect(fx.opener).proposeCreator(fx.opener.address)).to.be.revertedWithCustomError(l.chest, "OnlyCreator");
      await l.chest.connect(fx.creator).proposeCreator(fx.opener.address);
      await expect(l.chest.connect(fx.trader).acceptCreator()).to.be.revertedWithCustomError(l.chest, "OnlyPendingCreator");
      await l.chest.connect(fx.opener).acceptCreator();
      expect(await l.chest.creator()).to.equal(fx.opener.address);
      await buy(fx, l.curve, "1");
      const before = await ethers.provider.getBalance(fx.opener.address);
      const tx = await fx.router.connect(fx.trader).open(l.token);
      await tx.wait();
      const loot = ethers.parseEther("0.01");
      expect((await ethers.provider.getBalance(fx.opener.address)) - before).to.equal((loot * 8900n) / BPS);
    });
  });

  describe("admin", () => {
    it("owner-only settings and sweep", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.router.connect(fx.creator).setTreasury(fx.creator.address)).to.be.revertedWithCustomError(fx.router, "OwnableUnauthorizedAccount");
      await expect(fx.router.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(fx.router, "ZeroAddress");
      await fx.router.setTreasury(fx.opener.address);
      expect(await fx.router.treasury()).to.equal(fx.opener.address);
      await fx.trader.sendTransaction({ to: fx.routerAddress, value: ethers.parseEther("0.3") });
      const before = await ethers.provider.getBalance(fx.opener.address);
      await fx.router.sweep();
      expect((await ethers.provider.getBalance(fx.opener.address)) - before).to.equal(ethers.parseEther("0.3"));
      await expect(fx.router.sweep()).to.not.be.reverted;
      await fx.router.transferOwnership(fx.creator.address);
      expect(await fx.router.owner()).to.equal(fx.deployer.address);
      await fx.router.connect(fx.creator).acceptOwnership();
      expect(await fx.router.owner()).to.equal(fx.creator.address);
    });

    it("pays the pad's share to the treasury of the day, taken from chests only", async () => {
      const fx = await loadFixture(deployFixture);
      const l = await launchOne(fx);
      await fx.router.setTreasury(fx.trader.address);
      await buy(fx, l.curve, "1");
      const before = await ethers.provider.getBalance(fx.trader.address);
      await fx.router.connect(fx.opener).open(l.token);
      expect((await ethers.provider.getBalance(fx.trader.address)) - before).to.equal((ethers.parseEther("0.01") * 1000n) / BPS);
      expect(await ethers.provider.getBalance(fx.routerAddress)).to.equal(0);
    });
  });
});
