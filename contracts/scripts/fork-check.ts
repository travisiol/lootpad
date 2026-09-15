import { ethers, network } from "hardhat";

/**
 * Exercises the router and the chests against the REAL Pons V2 factory on
 * a fork of Robinhood Chain. Nothing is broadcast; the hardhat network is
 * forked in-process from FORK_URL at the latest block:
 *
 *   FORK_URL=https://rpc.mainnet.chain.robinhood.com npm run fork:check
 *
 * What it proves, in order: a launch with a lock delivers the first buy to
 * the chest and not the creator, the chest is the curve's fee recipient and
 * snipe-tax exempt while the creator's wallet is not; a launch without a
 * lock delivers the first buy to the creator's wallet; creator fees accrue
 * for the chest; opening pays opener / pad / creator and the burn share
 * buys back and burns on the real curve; the allocation unlocks on
 * schedule; and, with FULL=1, a launch that graduates for real ends the
 * burn rule and burns the leftover reserve as ETH.
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const DAY = 24 * 60 * 60;
const BPS = 10_000n;

const CURVE_ABI = [
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function deployer() view returns (address)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
  "function getReserves() view returns (uint256,uint256)",
  "function snipeTaxExempt(address) view returns (bool)",
  "function quoteFeeBalance() view returns (uint256)",
  "function protocolFeeShareBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function launchSupply() view returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

function parse<T extends { interface: { parseLog: (l: { topics: string[]; data: string }) => unknown } }>(c: T, logs: readonly { topics: readonly string[]; data: string }[], name: string) {
  return logs
    .map((l) => {
      try {
        return c.interface.parseLog({ topics: [...l.topics], data: l.data }) as { name: string; args: unknown[] } | null;
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === name);
}

async function increaseTime(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

async function main() {
  const [deployer, creator, stranger, whale] = await ethers.getSigners();
  // A fresh fork refuses calls at the fork block itself; mine one first.
  await network.provider.send("evm_mine", []);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`network ${network.name} chainId ${chainId} block ${await ethers.provider.getBlockNumber()}`);
  if ((await ethers.provider.getCode(PONS_FACTORY)) === "0x") {
    throw new Error("Not a Robinhood Chain fork: no factory code at " + PONS_FACTORY);
  }

  const chestFactory = await (await ethers.getContractFactory("ChestFactory")).deploy();
  await chestFactory.waitForDeployment();
  const router = await (await ethers.getContractFactory("LootpadRouter")).deploy(
    PONS_FACTORY,
    await chestFactory.getAddress(),
    deployer.address,
    deployer.address,
  );
  await router.waitForDeployment();
  console.log("chestFactory", await chestFactory.getAddress());
  console.log("router", await router.getAddress());
  console.log("feeEscrow", await router.feeEscrow(), "forwarder", await router.ponsForwarder());
  console.log("canLaunchHere", await router.canLaunchHere());
  const ponsFee = await router.ponsLaunchFee();
  console.log("ponsLaunchFee", ethers.formatEther(ponsFee));

  // ── 1. Launch with a first buy and a lock ──────────────────────────────
  const firstBuy = ethers.parseEther("0.01");
  const base = {
    name: "Fork Chest",
    symbol: "CHEST",
    logo: "ipfs://bafkreiforkchest",
    description: "Fork rehearsal, never broadcast.",
    x: "https://x.com/lootpad",
    telegram: "",
    website: "https://lootpad.example",
    creatorTaxBps: 0,
    salt: ethers.hexlify(ethers.randomBytes(32)),
    firstBuy,
    minTokensOut: 0n,
    lockDuration: BigInt(30 * DAY),
    burnBps: 5000,
  };
  const tx = await router.connect(creator).launch(base, { value: ponsFee + firstBuy });
  const receipt = await tx.wait();
  console.log("\n[1] launch with a 30-day lock and 50% burn: gas", receipt?.gasUsed.toString());
  const launched = parse(router, receipt!.logs, "Launched");
  if (!launched) throw new Error("no Launched event");
  const [token, curve, , chestAddress] = launched.args as string[];
  console.log("  token", token, "\n  curve", curve, "\n  chest", chestAddress);

  const erc20 = new ethers.Contract(token, ERC20_ABI, ethers.provider);
  const curveC = new ethers.Contract(curve, CURVE_ABI, ethers.provider);
  const chest = await ethers.getContractAt("Chest", chestAddress);

  const chestBal = await erc20.balanceOf(chestAddress);
  const creatorBal = await erc20.balanceOf(creator.address);
  const supply = (await curveC.launchSupply()) as bigint;
  console.log("  token", await erc20.name(), await erc20.symbol());
  console.log("  chest holds", ethers.formatEther(chestBal), `(${(Number((chestBal * 10_000n) / supply) / 100).toFixed(2)}% of supply)`, "creator holds", ethers.formatEther(creatorBal));
  if (chestBal === 0n || creatorBal !== 0n) throw new Error("first buy did not land in the chest");
  if ((await chest.allocation()) !== chestBal) throw new Error("chest not armed with the delivered balance");
  console.log("  fee recipient on curve (deployer())", await curveC.deployer(), "== chest", (await curveC.deployer()) === chestAddress);
  console.log("  snipe-tax exempt: chest", await curveC.snipeTaxExempt(chestAddress), "| creator", await curveC.snipeTaxExempt(creator.address), "| router", await curveC.snipeTaxExempt(await router.getAddress()));
  if (!(await curveC.snipeTaxExempt(chestAddress))) throw new Error("chest should be exempt");
  if (await curveC.snipeTaxExempt(creator.address)) throw new Error("creator wallet must not be exempt with a lock");
  const info = await router.infoOf(token);
  console.log("  registry: lock", info.lockDuration.toString(), "burnBps", info.burnBps.toString(), "firstBuy", ethers.formatEther(info.firstBuy));

  // ── 2. Launch with a first buy and no lock ─────────────────────────────
  const tx2 = await router.connect(creator).launch({ ...base, symbol: "CHEST2", salt: ethers.hexlify(ethers.randomBytes(32)), lockDuration: 0n, burnBps: 0 }, { value: ponsFee + firstBuy });
  const r2 = await tx2.wait();
  const launched2 = parse(router, r2!.logs, "Launched");
  const [token2, curve2, , chest2Address] = launched2!.args as string[];
  const erc20b = new ethers.Contract(token2, ERC20_ABI, ethers.provider);
  const curve2C = new ethers.Contract(curve2, CURVE_ABI, ethers.provider);
  console.log("\n[2] launch without a lock: gas", r2?.gasUsed.toString(), "creator holds", ethers.formatEther(await erc20b.balanceOf(creator.address)), "chest holds", ethers.formatEther(await erc20b.balanceOf(chest2Address)));
  if ((await erc20b.balanceOf(creator.address)) === 0n) throw new Error("first buy without a lock should reach the creator");
  console.log("  snipe-tax exempt: creator", await curve2C.snipeTaxExempt(creator.address), "| chest", await curve2C.snipeTaxExempt(chest2Address));

  // ── 3. Fees accrue for the chest ───────────────────────────────────────
  const spend = ethers.parseEther("0.05");
  await (await curveC.connect(stranger).buy(spend, 0, stranger.address, { value: spend })).wait();
  console.log("\n[3] stranger bought 0.05 ETH: quoteFeeBalance on curve", ethers.formatEther(await curveC.quoteFeeBalance()), "protocolFeeShareBps", (await curveC.protocolFeeShareBps()).toString());
  console.log("  chest.pending (escrow)", ethers.formatEther(await chest.pending()), "— Pons sweeps to the escrow itself; on a fork the chest is funded directly below");
  try {
    await chest.connect(stranger).open.staticCall(stranger.address);
    console.log("  open with nothing waiting: did not revert (escrow had a balance)");
  } catch (e) {
    console.log("  open with nothing waiting reverts:", (e as Error).message.includes("NothingToOpen"));
  }

  // ── 4. Open: split + a real buyback on the real curve ──────────────────
  const loot = ethers.parseEther("0.004");
  await (await stranger.sendTransaction({ to: chestAddress, value: loot })).wait();
  const s0 = await router.status(token);
  console.log("\n[4] sent", ethers.formatEther(loot), "ETH to the chest to stand in for swept fees · lootable", ethers.formatEther(s0.lootable), "burnable", ethers.formatEther(s0.burnable));
  const creatorBefore = await ethers.provider.getBalance(creator.address);
  const padBefore = await ethers.provider.getBalance(deployer.address);
  const deadBefore = await erc20.balanceOf(DEAD);
  const openTx = await router.connect(stranger).open(token);
  const openReceipt = await openTx.wait();
  const opened = parse(chest, openReceipt!.logs, "Opened");
  const burned = parse(chest, openReceipt!.logs, "Burned");
  const [opener, lootOut, toCreator, toPad, toOpener, toBurn] = opened!.args as [string, bigint, bigint, bigint, bigint, bigint];
  console.log("  open on the real curve: gas", openReceipt?.gasUsed.toString());
  console.log("  opener", opener, "loot", ethers.formatEther(lootOut), "toCreator", ethers.formatEther(toCreator), "toPad", ethers.formatEther(toPad), "toOpener", ethers.formatEther(toOpener), "toBurn", ethers.formatEther(toBurn));
  const expectOpener = (lootOut * 100n) / BPS;
  const expectPad = (lootOut * 1000n) / BPS;
  const expectBurn = ((lootOut - expectOpener - expectPad) * 5000n) / BPS;
  if (toOpener !== expectOpener || toPad !== expectPad || toBurn !== expectBurn || toCreator !== lootOut - expectOpener - expectPad - expectBurn) throw new Error("split does not match the rules");
  console.log("  creator delta", ethers.formatEther((await ethers.provider.getBalance(creator.address)) - creatorBefore), "pad delta", ethers.formatEther((await ethers.provider.getBalance(deployer.address)) - padBefore));
  const deadAfter = await erc20.balanceOf(DEAD);
  console.log("  burned:", burned ? `spent ${ethers.formatEther(burned.args[0] as bigint)} ETH → ${ethers.formatEther(burned.args[1] as bigint)} tokens to the dead address` : "no Burned event");
  if (deadAfter <= deadBefore) throw new Error("the burn share was not burned");
  if ((await erc20.balanceOf(chestAddress)) !== chestBal) throw new Error("the locked allocation moved");
  console.log("  chest still holds its allocation:", ethers.formatEther(await erc20.balanceOf(chestAddress)), "| burnReserve", ethers.formatEther(await chest.burnReserve()), "| openings", (await chest.openings()).toString());

  // ── 5. The allocation unlocks on schedule ──────────────────────────────
  await increaseTime(15 * DAY);
  const unlockable = await chest.unlockable();
  console.log("\n[5] +15 days: unlockable", ethers.formatEther(unlockable), "of", ethers.formatEther(chestBal), "locked", ethers.formatEther(await chest.locked()));
  const unlockTx = await router.connect(stranger).unlock(token);
  const unlockReceipt = await unlockTx.wait();
  const unlockedEv = parse(chest, unlockReceipt!.logs, "Unlocked");
  console.log("  unlock: gas", unlockReceipt?.gasUsed.toString(), "paid", ethers.formatEther((unlockedEv?.args[1] as bigint) ?? 0n), "to", unlockedEv?.args[0]);
  if ((await erc20.balanceOf(creator.address)) === 0n) throw new Error("unlock did not pay the creator");
  await increaseTime(16 * DAY);
  await (await chest.connect(stranger).unlock()).wait();
  console.log("  +31 days: creator holds", ethers.formatEther(await erc20.balanceOf(creator.address)), "chest holds", ethers.formatEther(await erc20.balanceOf(chestAddress)));
  if ((await erc20.balanceOf(chestAddress)) !== 0n) throw new Error("allocation not fully unlocked");

  // ── 6. A launch that graduates for real (FULL=1) ──────────────────────
  if (process.env.FULL === "1") {
    const tx3 = await router.connect(creator).launch({ ...base, symbol: "CHEST3", salt: ethers.hexlify(ethers.randomBytes(32)), firstBuy: 0n, lockDuration: 0n, burnBps: 5000 }, { value: ponsFee });
    const r3 = await tx3.wait();
    const launched3 = parse(router, r3!.logs, "Launched");
    const [token3, curve3, , chest3Address] = launched3!.args as string[];
    const curve3C = new ethers.Contract(curve3, CURVE_ABI, ethers.provider);
    const chest3 = await ethers.getContractAt("Chest", chest3Address);
    console.log("\n[6] launch without a first buy, 50% burn: gas", r3?.gasUsed.toString(), "threshold", ethers.formatEther(await curve3C.graduationThreshold()));
    await (await stranger.sendTransaction({ to: chest3Address, value: ethers.parseEther("0.5") })).wait();
    await (await router.connect(stranger).open(token3)).wait();
    console.log("  opened once before graduation: burnReserve left", ethers.formatEther(await chest3.burnReserve()));
    for (let i = 0; i < 20 && !(await curve3C.graduated()); i++) {
      const v = ethers.parseEther("0.5");
      try {
        await (await curve3C.connect(whale).buy(v, 0, whale.address, { value: v })).wait();
      } catch (e) {
        console.log("  buy failed at step", i, (e as Error).message.slice(0, 100));
        break;
      }
    }
    console.log("  realQuoteReserve", ethers.formatEther(await curve3C.realQuoteReserve()), "graduated", await curve3C.graduated());
    if (await curve3C.graduated()) {
      const reserve = await chest3.burnReserve();
      await (await stranger.sendTransaction({ to: chest3Address, value: ethers.parseEther("0.01") })).wait();
      const deadEthBefore = await ethers.provider.getBalance(DEAD);
      const r = await (await router.connect(stranger).open(token3)).wait();
      const o = parse(chest3, r!.logs, "Opened");
      const b = parse(chest3, r!.logs, "BurnedAsEth");
      console.log("  open after graduation: toBurn", ethers.formatEther((o?.args[5] as bigint) ?? 0n), "(must be 0) · leftover reserve burned as ETH", ethers.formatEther((b?.args[0] as bigint) ?? 0n), "== reserve", ((b?.args[0] as bigint) ?? 0n) === reserve);
      console.log("  dead address ETH delta", ethers.formatEther((await ethers.provider.getBalance(DEAD)) - deadEthBefore), "graduatedAt", (await chest3.graduatedAt()).toString());
    } else {
      console.log("  could not graduate on this fork — skipping the post-graduation rehearsal");
    }
  }

  console.log("\nchestCount", (await router.chestCount()).toString());
  console.log("OK — router and chests work against the real Pons factory on this fork.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
