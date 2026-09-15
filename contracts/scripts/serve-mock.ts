import * as http from "http";
import { ethers, network } from "hardhat";

/**
 * The front-end rehearsal that cannot expire: the router and the chests on
 * a plain in-process hardhat network in front of the mock Pons (no fork,
 * no remote state), seeded with three chests in three states and served
 * over JSON-RPC on PORT (default 8596).
 *
 *   PORT=8596 npx hardhat run scripts/serve-mock.ts
 *
 * The mock curve is a constant product with Pons' numbers (1.68 ETH of
 * phantom quote, 1% fee, 4.2 ETH graduation), so prices and splits look
 * right; what it does not do is Pons' fee sweep — creator fees are credited
 * to the escrow on every trade instead of waiting on the curve. The real
 * factory is exercised by scripts/fork-check.ts.
 *
 * Chests seeded:
 *   1. Phoenix   — 90-day lock, 75% burn, 20 days in, opened once (a burn happened)
 *   2. Goblin    — no lock, 3% creator fee, opened once
 *   3. Dragon    — fresh: 30-day lock, 50% burn, loot waiting, never opened
 */
const DAY = 24 * 60 * 60;
const PORT = Number(process.env.PORT ?? 8596);
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

async function increaseTime(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

async function main() {
  const [deployer, creator, trader, , , browser] = await ethers.getSigners();

  // Multicall3 at its canonical address, so viem's batched reads work.
  const mc = await (await ethers.getContractFactory("Multicall3")).deploy();
  await mc.waitForDeployment();
  await network.provider.send("hardhat_setCode", [MULTICALL3, await ethers.provider.getCode(await mc.getAddress())]);

  const factory = await (await ethers.getContractFactory("MockPonsFactory")).deploy(deployer.address);
  await factory.waitForDeployment();
  const chestFactory = await (await ethers.getContractFactory("ChestFactory")).deploy();
  await chestFactory.waitForDeployment();
  const router = await (await ethers.getContractFactory("LootpadRouter")).deploy(await factory.getAddress(), await chestFactory.getAddress(), deployer.address, deployer.address);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  const ponsFee = await router.ponsLaunchFee();

  const launch = async (overrides: Record<string, unknown>) => {
    const p = {
      name: "Seed",
      symbol: "SEED",
      logo: "",
      description: "Seeded for the front end.",
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
    const tx = await router.connect(creator).launch(p, { value: ponsFee + (p.firstBuy as bigint) });
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
    return { token, chest, curve: await ethers.getContractAt("MockCurve", curve) };
  };

  const buy = async (curve: Awaited<ReturnType<typeof launch>>["curve"], who: typeof trader, eth: string) => {
    const v = ethers.parseEther(eth);
    await (await curve.connect(who).buy(v, 0, who.address, { value: v })).wait();
  };

  // 1. Phoenix — legendary-grade rules, 20 days in, opened once.
  const a = await launch({
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
  await (await router.connect(trader).open(a.token)).wait();

  // 2. Goblin — no lock, a creator fee, opened once.
  const b = await launch({
    name: "Goblin Market",
    symbol: "GOB",
    description: "No lock, no burn, a 3% creator fee. Everything the chest says about it is true, and none of it is reassuring.",
    firstBuy: ethers.parseEther("0.01"),
    lockDuration: 0n,
    burnBps: 0,
    creatorTaxBps: 300,
  });
  await buy(b.curve, trader, "0.05");
  await (await router.connect(trader).open(b.token)).wait();

  await increaseTime(20 * DAY);

  // 3. Dragon — fresh, loot waiting, never opened.
  const c = await launch({
    name: "Dragon Hoard",
    symbol: "HOARD",
    description: "A 30-day lock on the creator's allocation and half of every opening burned. Fresh out of the forge.",
    firstBuy: ethers.parseEther("0.03"),
    lockDuration: BigInt(30 * DAY),
    burnBps: 5000,
  });
  await buy(c.curve, trader, "0.15");
  await buy(c.curve, trader, "0.05");
  await buy(c.curve, browser, "0.01");

  for (const l of [a, b, c]) console.log("chest", l.token, "→", l.chest);
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
  server.listen(PORT, () => console.log(`\nserving the mock network on http://127.0.0.1:${PORT} — Ctrl+C to stop`));
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
