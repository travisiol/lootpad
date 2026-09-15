import type { Tier } from "@/lib/rules";

/**
 * Shapes served by /api/chests and /api/chest/<address>/*. Everything is
 * read from Robinhood Chain — the router for the list, the metadata and
 * the chest, the Pons curve for the market, the fee escrow for pending
 * creator fees. No indexer.
 */

export type ChestMarket = {
  /** ETH per token, from the curve's (virtual) reserves. */
  priceEth: number;
  /** Null when no ETH/USD quote is available. */
  priceUsd: number | null;
  marketCapEth: number;
  marketCapUsd: number | null;
  /** ETH actually raised on the curve so far. */
  raisedEth: number;
  graduationProgressPct: number;
  graduated: boolean;
  /** Tokens on the curve at launch, whole tokens. */
  launchSupply: number;
};

/** Chest.Status, every uint as a decimal string. */
export type ChestStatusJson = {
  armed: boolean;
  graduated: boolean;
  graduatedLive: boolean;
  launchedAt: number;
  lockEnd: number;
  allocation: string;
  unlocked: string;
  unlockable: string;
  locked: string;
  pending: string;
  lootable: string;
  burnReserve: string;
  burnable: string;
  nextBurnAt: number;
  totalLoot: string;
  totalToCreator: string;
  totalToPad: string;
  totalToOpeners: string;
  totalBurnedEth: string;
  tokensBurned: string;
  openings: number;
};

export type ChestItem = {
  token: string;
  curve: string;
  creator: string;
  chest: string;
  creatorTaxBps: number;
  burnBps: number;
  /** First buy in wei, as a decimal string. */
  firstBuy: string;
  /** Seconds. Zero: no lock. */
  lockDuration: number;
  launchedAt: number;
  launchBlock: number;
  name: string;
  symbol: string;
  /** `ipfs://<cid>` or an https URL. Empty when the launch has no image. */
  logo: string;
  description: string;
  tier: Tier;
  /** The allocation as a share of the launch supply, in percent. */
  allocationPct: number;
  market: ChestMarket;
  status: ChestStatusJson;
};

export type ChestsResponse = {
  ok: boolean;
  chests: ChestItem[];
  /** Unix seconds the chain was read at, so countdowns start from the same clock. */
  readAt: number;
};

export type MarketSummary = ChestMarket & {
  graduationThresholdEth: number;
  ethUsd: number | null;
  venue: "curve" | "pool";
  /** The creator's share of fees still on the curve, waiting for Pons' sweep, in wei. */
  accruingWei: string;
};

export type SummaryResponse = {
  ok: boolean;
  chest: ChestItem;
  market: MarketSummary;
  readAt: number;
};

export type Trade = {
  id: string;
  side: "buy" | "sell";
  /** Token amount in base units (18 decimals), decimal string. */
  tokenAmount: string;
  /** Quote amount in wei, decimal string. */
  quoteAmount: string;
  account: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
};

export type TradesResponse = { ok: boolean; trades: Trade[] };

export type Opening = {
  id: string;
  opener: string;
  loot: string;
  toCreator: string;
  toPad: string;
  toOpener: string;
  toBurn: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
};

export type OpeningsResponse = { ok: boolean; openings: Opening[] };

export type ChartPoint = {
  t: number;
  /** Price in ETH per token. */
  price: number;
};

export type ChartResponse = {
  ok: boolean;
  token: string;
  ethUsd: number | null;
  launchSupply: number;
  points: ChartPoint[];
};

/**
 * Where to load a logo from, in order. `ipfs://` goes to the Pons gateway
 * first (it serves what Pons pinned), then to public gateways for images
 * pinned elsewhere; https URLs pass through.
 */
export function logoCandidates(logo: string | null | undefined): string[] {
  if (!logo) return [];
  if (logo.startsWith("ipfs://")) {
    const cid = logo.slice("ipfs://".length).replace(/^ipfs\//, "");
    if (!/^[a-zA-Z0-9]+$/.test(cid)) return [];
    return [
      `https://www.ponsfamily.com/api/ipfs/content/${cid}?variant=card`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
    ];
  }
  if (/^https:\/\/\S+$/.test(logo)) return [logo];
  return [];
}

/** The first candidate, for places that only take one URL. */
export function logoUrl(logo: string | null | undefined): string | null {
  return logoCandidates(logo)[0] ?? null;
}
