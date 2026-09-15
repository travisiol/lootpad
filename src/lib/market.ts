import { formatEther, parseAbiItem, type Address } from "viem";
import { chainClient } from "@/lib/chainClient";
import { cached } from "@/lib/cache";
import { ROUTER_ADDRESS, routerAbi } from "@/lib/contracts";
import { curveAbi } from "@/lib/ponsAbi";
import { tierOf } from "@/lib/rules";
import type { ChartPoint, ChestItem, ChestMarket, ChestStatusJson, MarketSummary, Opening, Trade } from "@/lib/pons";

/**
 * Everything the site knows about a chest, read from the chain: the router
 * for the list, the metadata and the chest's status, the Pons curve for
 * reserves and graduation. No indexer, no database.
 */

const ETH_USD_TTL = 60_000;
const LIST_TTL = 12_000;
const SUMMARY_TTL = 10_000;
const TRADES_TTL = 15_000;

const wei = (v: bigint) => Number(formatEther(v));

/**
 * The chain's clock, not the server's: every lock end is a block
 * timestamp, so countdowns are measured from the latest block. Falls back
 * to the wall clock if the read fails.
 */
function chainNow(): Promise<number> {
  return cached("chainNow", 5_000, async () => {
    try {
      const block = await chainClient().getBlock({ blockTag: "latest" });
      return Number(block.timestamp);
    } catch {
      return Math.floor(Date.now() / 1000);
    }
  });
}

/** ETH/USD from Coinbase's public spot endpoint; null when unreachable. */
export function ethUsd(): Promise<number | null> {
  return cached("ethUsd", ETH_USD_TTL, async () => {
    try {
      const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { next: { revalidate: 60 } });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { amount?: string } };
      const n = Number(json.data?.amount);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
}

type CurveState = {
  quote: bigint;
  tokens: bigint;
  realQuote: bigint;
  threshold: bigint;
  graduated: boolean;
  launchSupply: bigint;
};

async function readCurves(curves: Address[]): Promise<CurveState[]> {
  if (curves.length === 0) return [];
  const results = await chainClient().multicall({
    allowFailure: true,
    contracts: curves.flatMap((address) => [
      { address, abi: curveAbi, functionName: "getReserves" } as const,
      { address, abi: curveAbi, functionName: "realQuoteReserve" } as const,
      { address, abi: curveAbi, functionName: "graduationThreshold" } as const,
      { address, abi: curveAbi, functionName: "graduated" } as const,
      { address, abi: curveAbi, functionName: "launchSupply" } as const,
    ]),
  });
  return curves.map((_, i) => {
    const r = results.slice(i * 5, i * 5 + 5);
    const reserves = (r[0].status === "success" ? r[0].result : [0n, 0n]) as readonly [bigint, bigint];
    return {
      quote: reserves[0],
      tokens: reserves[1],
      realQuote: r[1].status === "success" ? (r[1].result as bigint) : 0n,
      threshold: r[2].status === "success" ? (r[2].result as bigint) : 0n,
      graduated: r[3].status === "success" ? (r[3].result as boolean) : false,
      launchSupply: r[4].status === "success" ? (r[4].result as bigint) : 0n,
    };
  });
}

/** ETH per token from the curve's (virtual) reserves. */
function priceEth(c: CurveState): number {
  if (c.tokens === 0n) return 0;
  return wei(c.quote) / wei(c.tokens);
}

function marketOf(c: CurveState, usd: number | null): ChestMarket {
  const p = priceEth(c);
  const supply = wei(c.launchSupply);
  const raised = wei(c.realQuote);
  const threshold = wei(c.threshold);
  const progress = c.graduated ? 100 : threshold > 0 ? Math.min(100, (raised / threshold) * 100) : 0;
  return {
    priceEth: p,
    priceUsd: usd === null ? null : p * usd,
    marketCapEth: p * supply,
    marketCapUsd: usd === null ? null : p * supply * usd,
    raisedEth: raised,
    graduationProgressPct: progress,
    graduated: c.graduated,
    launchSupply: supply,
  };
}

type RouterInfo = {
  token: Address;
  curve: Address;
  creator: Address;
  chest: Address;
  creatorTaxBps: number;
  burnBps: number;
  firstBuy: bigint;
  lockDuration: bigint;
  launchedAt: bigint;
  launchBlock: bigint;
  name: string;
  symbol: string;
  logo: string;
  description: string;
};

type StatusRaw = {
  armed: boolean;
  graduated: boolean;
  graduatedLive: boolean;
  launchedAt: bigint;
  lockEnd: bigint;
  allocation: bigint;
  unlocked: bigint;
  unlockable: bigint;
  locked: bigint;
  pending: bigint;
  lootable: bigint;
  burnReserve: bigint;
  burnable: bigint;
  nextBurnAt: bigint;
  totalLoot: bigint;
  totalToCreator: bigint;
  totalToPad: bigint;
  totalToOpeners: bigint;
  totalBurnedEth: bigint;
  tokensBurned: bigint;
  openings: number;
};

const EMPTY_STATUS: ChestStatusJson = {
  armed: false,
  graduated: false,
  graduatedLive: false,
  launchedAt: 0,
  lockEnd: 0,
  allocation: "0",
  unlocked: "0",
  unlockable: "0",
  locked: "0",
  pending: "0",
  lootable: "0",
  burnReserve: "0",
  burnable: "0",
  nextBurnAt: 0,
  totalLoot: "0",
  totalToCreator: "0",
  totalToPad: "0",
  totalToOpeners: "0",
  totalBurnedEth: "0",
  tokensBurned: "0",
  openings: 0,
};

function statusJson(s: StatusRaw): ChestStatusJson {
  return {
    armed: s.armed,
    graduated: s.graduated,
    graduatedLive: s.graduatedLive,
    launchedAt: Number(s.launchedAt),
    lockEnd: Number(s.lockEnd),
    allocation: s.allocation.toString(),
    unlocked: s.unlocked.toString(),
    unlockable: s.unlockable.toString(),
    locked: s.locked.toString(),
    pending: s.pending.toString(),
    lootable: s.lootable.toString(),
    burnReserve: s.burnReserve.toString(),
    burnable: s.burnable.toString(),
    nextBurnAt: Number(s.nextBurnAt),
    totalLoot: s.totalLoot.toString(),
    totalToCreator: s.totalToCreator.toString(),
    totalToPad: s.totalToPad.toString(),
    totalToOpeners: s.totalToOpeners.toString(),
    totalBurnedEth: s.totalBurnedEth.toString(),
    tokensBurned: s.tokensBurned.toString(),
    openings: Number(s.openings),
  };
}

async function readStatuses(router: Address, tokens: Address[]): Promise<ChestStatusJson[]> {
  if (tokens.length === 0) return [];
  const results = await chainClient().multicall({
    allowFailure: true,
    contracts: tokens.map((token) => ({ address: router, abi: routerAbi, functionName: "status", args: [token] }) as const),
  });
  return results.map((r) => (r.status === "success" ? statusJson(r.result as unknown as StatusRaw) : EMPTY_STATUS));
}

function itemOf(l: RouterInfo, market: ChestMarket, status: ChestStatusJson): ChestItem {
  const allocation = BigInt(status.allocation);
  const supply = market.launchSupply;
  return {
    token: l.token,
    curve: l.curve,
    creator: l.creator,
    chest: l.chest,
    creatorTaxBps: l.creatorTaxBps,
    burnBps: l.burnBps,
    firstBuy: l.firstBuy.toString(),
    lockDuration: Number(l.lockDuration),
    launchedAt: Number(l.launchedAt),
    launchBlock: Number(l.launchBlock),
    name: l.name,
    symbol: l.symbol,
    logo: l.logo,
    description: l.description,
    tier: tierOf({ firstBuyWei: l.firstBuy, lockSeconds: Number(l.lockDuration), burnBps: l.burnBps, creatorTaxBps: l.creatorTaxBps }),
    allocationPct: supply > 0 ? (wei(allocation) / supply) * 100 : 0,
    market,
    status,
  };
}

/** Newest first. Empty until the router exists and someone launches. */
export function listChests(limit: number): Promise<{ chests: ChestItem[]; readAt: number }> {
  if (!ROUTER_ADDRESS) return Promise.resolve({ chests: [], readAt: Math.floor(Date.now() / 1000) });
  const router = ROUTER_ADDRESS;
  return cached(`chests:${limit}`, LIST_TTL, async () => {
    const [page, usd, readAt] = await Promise.all([
      chainClient().readContract({ address: router, abi: routerAbi, functionName: "chests", args: [0n, BigInt(limit)] }) as Promise<readonly RouterInfo[]>,
      ethUsd(),
      chainNow(),
    ]);
    const [curves, statuses] = await Promise.all([readCurves(page.map((l) => l.curve)), readStatuses(router, page.map((l) => l.token))]);
    return { chests: page.map((l, i) => itemOf(l, marketOf(curves[i], usd), statuses[i])), readAt };
  });
}

export function chestCount(): Promise<number> {
  if (!ROUTER_ADDRESS) return Promise.resolve(0);
  const router = ROUTER_ADDRESS;
  return cached("chestCount", LIST_TTL, async () => {
    const n = (await chainClient().readContract({ address: router, abi: routerAbi, functionName: "chestCount" })) as bigint;
    return Number(n);
  });
}

async function tokenInfo(token: Address): Promise<RouterInfo | null> {
  if (!ROUTER_ADDRESS) return null;
  const router = ROUTER_ADDRESS;
  return cached(`info:${token.toLowerCase()}`, 60_000, async () => {
    try {
      return (await chainClient().readContract({ address: router, abi: routerAbi, functionName: "infoOf", args: [token] })) as RouterInfo;
    } catch {
      return null;
    }
  });
}

export function chestSummary(token: Address): Promise<{ chest: ChestItem; market: MarketSummary; readAt: number } | null> {
  return cached(`summary:${token.toLowerCase()}`, SUMMARY_TTL, async () => {
    const info = await tokenInfo(token);
    if (!info || !ROUTER_ADDRESS) return null;
    const client = chainClient();
    const [[curve], usd, [status], onCurve, protocolShareBps, readAt] = await Promise.all([
      readCurves([info.curve]),
      ethUsd(),
      readStatuses(ROUTER_ADDRESS, [token]),
      client.readContract({ address: info.curve, abi: curveAbi, functionName: "quoteFeeBalance" }).catch(() => 0n) as Promise<bigint>,
      client.readContract({ address: info.curve, abi: curveAbi, functionName: "protocolFeeShareBps" }).catch(() => 0n) as Promise<bigint>,
      chainNow(),
    ]);
    // Fees sit on the curve until Pons sweeps them; the creator's share is
    // whatever is left after the protocol's cut.
    const accruing = (onCurve * (10_000n - protocolShareBps)) / 10_000n;
    const m = marketOf(curve, usd);
    const market: MarketSummary = {
      ...m,
      graduationThresholdEth: wei(curve.threshold),
      ethUsd: usd,
      venue: m.graduated ? "pool" : "curve",
      accruingWei: accruing.toString(),
    };
    return { chest: itemOf(info, m, status), market, readAt };
  });
}

const BUY = parseAbiItem(
  "event CurveBuy(address indexed sender, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 snipeTax)",
);
const SELL = parseAbiItem(
  "event CurveSell(address indexed sender, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 snipeTax)",
);
const OPENED = parseAbiItem(
  "event Opened(address indexed opener, uint256 loot, uint256 toCreator, uint256 toPad, uint256 toOpener, uint256 toBurn)",
);

const TRADES_WANTED = 60;
const CHUNK = 100_000n;
const MAX_CHUNKS = 24;

async function stampBlocks(numbers: bigint[]): Promise<Map<bigint, number>> {
  const client = chainClient();
  const stamps = new Map<bigint, number>();
  await Promise.all(
    [...new Set(numbers)].map(async (n) => {
      const b = await client.getBlock({ blockNumber: n });
      stamps.set(n, Number(b.timestamp));
    }),
  );
  return stamps;
}

/**
 * Curve trades, newest first, scanned backwards from the head in block
 * windows until enough are found or the launch block is reached. Trades
 * after graduation happen in the pool and are not listed here.
 */
export function chestTrades(token: Address): Promise<Trade[]> {
  return cached(`trades:${token.toLowerCase()}`, TRADES_TTL, async () => {
    const info = await tokenInfo(token);
    if (!info) return [];
    const client = chainClient();
    const head = await client.getBlockNumber();
    const floor = info.launchBlock;
    const found: { log: { blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number }; side: "buy" | "sell"; tokens: bigint; quote: bigint; account: Address }[] = [];
    let to = head;
    for (let i = 0; i < MAX_CHUNKS && to >= floor && found.length < TRADES_WANTED; i++) {
      const from = to - CHUNK + 1n > floor ? to - CHUNK + 1n : floor;
      const [buys, sells] = await Promise.all([
        client.getLogs({ address: info.curve, event: BUY, fromBlock: from, toBlock: to }),
        client.getLogs({ address: info.curve, event: SELL, fromBlock: from, toBlock: to }),
      ]);
      for (const l of buys) found.push({ log: l, side: "buy", tokens: l.args.tokensOut!, quote: l.args.quoteIn!, account: l.args.recipient! });
      for (const l of sells) found.push({ log: l, side: "sell", tokens: l.args.tokensIn!, quote: l.args.quoteOut!, account: l.args.sender! });
      to = from - 1n;
    }
    found.sort((a, b) => (a.log.blockNumber === b.log.blockNumber ? b.log.logIndex - a.log.logIndex : Number(b.log.blockNumber - a.log.blockNumber)));
    const top = found.slice(0, TRADES_WANTED);
    const stamps = await stampBlocks(top.map((t) => t.log.blockNumber));
    return top.map((t) => ({
      id: `${t.log.transactionHash}:${t.log.logIndex}`,
      side: t.side,
      tokenAmount: t.tokens.toString(),
      quoteAmount: t.quote.toString(),
      account: t.account,
      transactionHash: t.log.transactionHash,
      blockNumber: Number(t.log.blockNumber),
      timestamp: stamps.get(t.log.blockNumber) ?? 0,
    }));
  });
}

/** The chest's openings, newest first: the loot log. */
export function chestOpenings(token: Address): Promise<Opening[]> {
  return cached(`openings:${token.toLowerCase()}`, TRADES_TTL, async () => {
    const info = await tokenInfo(token);
    if (!info) return [];
    const client = chainClient();
    const head = await client.getBlockNumber();
    const floor = info.launchBlock;
    const found: Awaited<ReturnType<typeof client.getLogs<typeof OPENED>>> = [];
    let to = head;
    for (let i = 0; i < MAX_CHUNKS && to >= floor && found.length < TRADES_WANTED; i++) {
      const from = to - CHUNK + 1n > floor ? to - CHUNK + 1n : floor;
      found.push(...(await client.getLogs({ address: info.chest, event: OPENED, fromBlock: from, toBlock: to })));
      to = from - 1n;
    }
    found.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)));
    const top = found.slice(0, TRADES_WANTED);
    const stamps = await stampBlocks(top.map((l) => l.blockNumber));
    return top.map((l) => ({
      id: `${l.transactionHash}:${l.logIndex}`,
      opener: l.args.opener!,
      loot: l.args.loot!.toString(),
      toCreator: l.args.toCreator!.toString(),
      toPad: l.args.toPad!.toString(),
      toOpener: l.args.toOpener!.toString(),
      toBurn: l.args.toBurn!.toString(),
      transactionHash: l.transactionHash,
      blockNumber: Number(l.blockNumber),
      timestamp: stamps.get(l.blockNumber) ?? 0,
    }));
  });
}

/** One price point per trade, oldest first, ending on the live price. */
export async function chestChart(token: Address): Promise<{ points: ChartPoint[]; ethUsd: number | null; launchSupply: number } | null> {
  const [trades, summary] = await Promise.all([chestTrades(token), chestSummary(token)]);
  if (!summary) return null;
  const points: ChartPoint[] = [...trades].reverse().map((t) => {
    const tokens = Number(t.tokenAmount) / 1e18;
    const quote = Number(t.quoteAmount) / 1e18;
    return { t: t.timestamp, price: tokens > 0 ? quote / tokens : 0 };
  });
  points.push({ t: summary.readAt, price: summary.market.priceEth });
  return { points, ethUsd: summary.market.ethUsd, launchSupply: summary.market.launchSupply };
}
