import * as http from "http";
import { ethers, network } from "hardhat";

/**
 * Front-end rehearsal without a live deployment: seeds the in-process fork
 * (FORK_URL) with the router and three chests in three states, then serves
 * that network over JSON-RPC on PORT (default 8596) so the site can be
 * pointed at it:
 *
 *   FORK_URL=https://rpc.mainnet.chain.robinhood.com npx hardhat run scripts/serve-fork.ts
 *
 *   NEXT_PUBLIC_LOOTPAD_ROUTER=<printed>
 *   NEXT_PUBLIC_ROBINHOOD_RPC_URL=http://127.0.0.1:8596
 *   NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=31337
 *   NEXT_PUBLIC_FORK_WALLET=<printed>      the browser's unlocked account
 *
 * Why in-process rather than `hardhat node`: the public Robinhood RPC only
 * keeps recent state, and a forked node that runs for more than a couple of
 * minutes starts failing remote reads. Seeding in one go and warming every
 * slot the site reads keeps everything cached.
 *
 * Chests seeded:
 *   1. Phoenix   — 90-day lock, 75% burn, 20 days in, opened once (a burn happened)
 *   2. Goblin    — no lock, 3% creator fee, opened once
 *   3. Dragon    — fresh: 30-day lock, 50% burn, loot waiting, never opened
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const DAY = 24 * 60 * 60;
const PORT = Number(process.env.PORT ?? 8596);

const CURVE_ABI = [
  "function graduated() view returns (bool)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
  "function realQuoteReserve() view returns (uint256)",
  "function getReserves() view returns (uint256,uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function launchSupply() view returns (uint256)",
  "function quoteFeeBalance() view returns (uint256)",
  "function protocolFeeShareBps() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address) view returns (uint256)",
  "function sell(uint256,uint256,address) returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

async function increaseTime(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

async function main() {
  const [deployer, creator, trader, , , browser] = await ethers.getSigners();
  await network.provider.send("evm_mine", []);
  if ((await ethers.provider.getCode(PONS_FACTORY)) === "0x") throw new Error("no Pons factory code — set FORK_URL to a Robinhood Chain RPC");

  const chestFactory = await (await ethers.getContractFactory("ChestFactory")).deploy();
  await chestFactory.waitForDeployment();
  const router = await (await ethers.getContractFactory("LootpadRouter")).deploy(PONS_FACTORY, await chestFactory.getAddress(), deployer.address, deployer.address);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  const ponsFee = await router.ponsLaunchFee();

  const launch = async (who: typeof creator, overrides: Record<string, unknown>) => {
    const p = {
      name: "Seed",
      symbol: "SEED",
      logo: "",
      description: "Seeded on a fork for the front end.",
      x: "https://x.com/lootpad",
      telegram: "",
      website: "",
      creatorTaxBps: 0,
      salt: ethers.hexlify(ethers.randomBytes(32)),
      firstBuy: 0n,
      minTokensOut: 0n,
      lockDuration: 0n,
      burnBps: 0,
      ...overrides,
    };
    const tx = await router.connect(who).launch(p, { value: ponsFee + (p.firstBuy as bigint) });
    const receipt = await tx.wait();
    const ev = receipt!.logs
      .map((l) => {
        try {
          return router.interface.parseLog({ topics: [...l.topics], data: l.data });
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "Launched")!;
    const [token, curve, , chest] = ev.args as unknown as [string, string, string, string];
    return { token, chest, curve: new ethers.Contract(curve, CURVE_ABI, ethers.provider) };
  };

  const buy = async (curve: import("ethers").Contract, who: import("ethers").Signer, eth: string) => {
    const v = ethers.parseEther(eth);
    await (await curve.connect(who).getFunction("buy")(v, 0, await who.getAddress(), { value: v })).wait();
  };

  /** Touch every view the site reads so the fork has it cached. */
  const warm = async (token: string, chest: string, curve: import("ethers").Contract) => {
    await router.status(token);
    await router.infoOf(token);
    await router.chests(0, 100);
    await router.chestCount();
    await curve.getReserves();
    await curve.realQuoteReserve();
    await curve.graduationThreshold();
    await curve.launchSupply();
    await curve.graduated();
    await curve.quoteFeeBalance().catch(() => 0n);
    await curve.protocolFeeShareBps().catch(() => 0n);
    await curve.feeBps().catch(() => 0n);
    await curve.creatorTaxBps().catch(() => 0n);
    for (const who of [creator.address, browser.address, trader.address]) {
      await curve.currentSnipeTaxBps(who).catch(() => 0n);
      const erc20 = new ethers.Contract(token, ERC20_ABI, ethers.provider);
      await erc20.balanceOf(who);
      await erc20.allowance(who, await curve.getAddress());
    }
    await ethers.provider.getBalance(chest);
    await ethers.provider.getBalance(browser.address);
  };

  // SEED=min seeds the fresh chest only: the public RPC forgets the pinned
  // block after ~10 minutes, and three launches with buys can take longer
  // than that when the RPC is busy.
  const minimal = process.env.SEED?.trim() === "min";
  const seeded: { token: string; chest: string; curve: import("ethers").Contract }[] = [];

  if (!minimal) {
  // 1. Phoenix — legendary-grade rules, 20 days in, opened once.
  const a = await launch(creator, {
    name: "Phoenix",
    symbol: "PHNX",
    description: "Rises from its own burn. 75% of every opening bought back and burned; the creator's allocation unlocks over 90 days.",
    firstBuy: ethers.parseEther("0.05"),
    lockDuration: BigInt(90 * DAY),
    burnBps: 7500,
    creatorTaxBps: 100,
  });
  await buy(a.curve, trader, "0.2");
  await buy(a.curve, trader, "0.1");
  // Pons sweeps curve fees to its escrow on its own schedule and refuses the
  // call from outside, so on a fork the chest would hold nothing: send it the
  // fees it would have received by now.
  await (await trader.sendTransaction({ to: a.chest, value: ethers.parseEther("0.006") })).wait();
  await (await router.connect(trader).open(a.token)).wait();

  // 2. Goblin — no lock, a creator fee, opened once.
  const b = await launch(creator, {
    name: "Goblin Market",
    symbol: "GOB",
    description: "No lock, no burn, a 3% creator fee. Everything the chest says about it is true, and none of it is reassuring.",
    firstBuy: ethers.parseEther("0.01"),
    lockDuration: 0n,
    burnBps: 0,
    creatorTaxBps: 300,
  });
  await buy(b.curve, trader, "0.05");
  await (await trader.sendTransaction({ to: b.chest, value: ethers.parseEther("0.0015") })).wait();
  await (await router.connect(trader).open(b.token)).wait();

  await increaseTime(20 * DAY);
  seeded.push(a, b);
  }

  // 3. Dragon — fresh, loot waiting, never opened.
  const c = await launch(creator, {
    name: "Dragon Hoard",
    symbol: "HOARD",
    description: "A 30-day lock on the creator's allocation and half of every opening burned. Fresh out of the forge.",
    firstBuy: ethers.parseEther("0.03"),
    lockDuration: BigInt(30 * DAY),
    burnBps: 5000,
  });
  await buy(c.curve, trader, "0.15");
  await buy(c.curve, trader, "0.05");
  // The browser account buys and sells once too, so both paths are warm for the trade panel.
  await buy(c.curve, browser, "0.01");
  const cErc20 = new ethers.Contract(c.token, ERC20_ABI, ethers.provider);
  const bal = (await cErc20.balanceOf(browser.address)) as bigint;
  await (await cErc20.connect(browser).getFunction("approve")(await c.curve.getAddress(), bal / 4n)).wait();
  await (await c.curve.connect(browser).getFunction("sell")(bal / 4n, 0, browser.address)).wait();
  await (await trader.sendTransaction({ to: c.chest, value: ethers.parseEther("0.004") })).wait();

  seeded.push(c);
  for (const l of seeded) await warm(l.token, l.chest, l.curve);
  for (const l of seeded) console.log("chest", l.token, "→", l.chest);

  if ((await ethers.provider.getCode(MULTICALL3)) === "0x") console.log("warning: no Multicall3 on this fork");

  console.log(`\nNEXT_PUBLIC_LOOTPAD_ROUTER=${routerAddress}`);
  console.log(`NEXT_PUBLIC_ROBINHOOD_RPC_URL=http://127.0.0.1:${PORT}`);
  console.log("NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=31337");
  console.log(`NEXT_PUBLIC_FORK_WALLET=${browser.address}`);

  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end("bad json");
        return;
      }
      const handle = async (call: { id?: unknown; method: string; params?: unknown[] }) => {
        try {
          const result = await network.provider.request({ method: call.method, params: call.params ?? [] });
          return { jsonrpc: "2.0", id: call.id ?? null, result };
        } catch (e) {
          const err = e as { code?: number; message?: string; data?: unknown };
          return { jsonrpc: "2.0", id: call.id ?? null, error: { code: typeof err.code === "number" ? err.code : -32000, message: err.message ?? "error", data: err.data } };
        }
      };
      const out = Array.isArray(payload) ? await Promise.all(payload.map(handle)) : await handle(payload as { method: string });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(PORT, () => console.log(`\nserving the seeded fork on http://127.0.0.1:${PORT} — Ctrl+C to stop`));
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
