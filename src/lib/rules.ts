import { site } from "@/lib/site";

/**
 * The rules of a chest, as the site reads them back. One place, used by the
 * launch form (the preview), the chest cards, the chest page and the docs,
 * so no two surfaces can disagree about what a chest does.
 *
 * Everything here mirrors the contracts: LootpadRouter fixes the pad's
 * and the opener's shares, Chest applies the burn share and the lock.
 */

export const BPS = 10_000n;
export const OPENER_BPS = BigInt(site.openerShareBps);
export const PAD_BPS = BigInt(site.padShareBps);
export const DAY = 86_400;

export type Rules = {
  /** The creator's first buy, in wei. Zero: no allocation. */
  firstBuyWei: bigint;
  /** How long the allocation takes to unlock, in seconds. Zero: no lock. */
  lockSeconds: number;
  /** Share of the creator's loot bought back and burned while on the curve. */
  burnBps: number;
  /** Creator tax on every trade, on top of Pons' fee. */
  creatorTaxBps: number;
};

/**
 * Rarity is earned by the rules a creator accepts — never rolled. Each tier
 * is a floor on how much the creator gave up. Tiers read the chest's own
 * rules only; a creator's other wallets are not something a contract can
 * see.
 */
export type Tier = "common" | "rare" | "epic" | "legendary";

export const TIERS: Record<Tier, { name: string; rank: number; color: string; requirement: string; blurb: string }> = {
  common: {
    name: "Common",
    rank: 0,
    color: "var(--iron)",
    requirement: "Any rules.",
    blurb: "The allocation is in the creator's wallet from block one. Nothing is locked; read the rules before you buy.",
  },
  rare: {
    name: "Rare",
    rank: 1,
    color: "var(--silver)",
    requirement: "Allocation locked 7+ days.",
    blurb: "The creator's first buy unlocks over at least a week instead of landing in a wallet.",
  },
  epic: {
    name: "Epic",
    rank: 2,
    color: "var(--violet)",
    requirement: "Locked 30+ days · 25%+ of the loot burned · creator fee ≤ 5%.",
    blurb: "A month-long unlock, a quarter of every opening bought back and burned, and a creator fee that stays reasonable.",
  },
  legendary: {
    name: "Legendary",
    rank: 3,
    color: "var(--gold)",
    requirement: "Locked 90+ days · 50%+ of the loot burned · creator fee ≤ 3%.",
    blurb: "The creator gave up the most: a quarter-year unlock, half the loot burned, and almost no creator fee.",
  },
};

export const TIER_ORDER: Tier[] = ["common", "rare", "epic", "legendary"];

/** The lock condition of a tier is met with no allocation at all: there is nothing to dump. */
function lockedFor(r: Rules, days: number): boolean {
  return r.firstBuyWei === 0n || r.lockSeconds >= days * DAY;
}

export function tierOf(r: Rules): Tier {
  if (lockedFor(r, 90) && r.burnBps >= 5000 && r.creatorTaxBps <= 300) return "legendary";
  if (lockedFor(r, 30) && r.burnBps >= 2500 && r.creatorTaxBps <= 500) return "epic";
  if (lockedFor(r, 7)) return "rare";
  return "common";
}

/** What stands between these rules and the next tier, in one line. Null at the top. */
export function nextTierHint(r: Rules): string | null {
  const tier = tierOf(r);
  if (tier === "legendary") return null;
  const wants: string[] = [];
  if (tier === "common") {
    wants.push("lock the allocation 7+ days");
  } else if (tier === "rare") {
    if (!lockedFor(r, 30)) wants.push("lock 30+ days");
    if (r.burnBps < 2500) wants.push("burn 25%+");
    if (r.creatorTaxBps > 500) wants.push("creator fee ≤ 5%");
  } else {
    if (!lockedFor(r, 90)) wants.push("lock 90+ days");
    if (r.burnBps < 5000) wants.push("burn 50%+");
    if (r.creatorTaxBps > 300) wants.push("creator fee ≤ 3%");
  }
  const next = TIER_ORDER[TIERS[tier].rank + 1];
  return `${TIERS[next].name}: ${wants.join(", ")}`;
}

export type Split = { opener: bigint; pad: bigint; burn: bigint; creator: bigint };

/**
 * How one opening splits `loot` wei — the contract's arithmetic, in the
 * same order: the key and the pad first, the burn share of the rest, the
 * rest to the creator. After graduation the burn share is zero.
 */
export function splitLoot(loot: bigint, burnBps: number, graduated = false): Split {
  if (loot <= 0n) return { opener: 0n, pad: 0n, burn: 0n, creator: 0n };
  const opener = (loot * OPENER_BPS) / BPS;
  const pad = (loot * PAD_BPS) / BPS;
  const rest = loot - opener - pad;
  const burn = graduated ? 0n : (rest * BigInt(burnBps)) / BPS;
  return { opener, pad, burn, creator: rest - burn };
}

/** The split as shares of 100%, for bars. Adds up to 100 by construction of the last term. */
export function splitPct(burnBps: number, graduated = false): { opener: number; pad: number; burn: number; creator: number } {
  const s = splitLoot(1_000_000n, burnBps, graduated);
  const f = (v: bigint) => Number(v) / 10_000;
  return { opener: f(s.opener), pad: f(s.pad), burn: f(s.burn), creator: 100 - f(s.opener) - f(s.pad) - f(s.burn) };
}

/** Of every trade's fee, the creator side (70%) goes to the chest; this is the creator's true take per 1 ETH traded, in bps of volume. */
export function creatorTakeBpsOfVolume(burnBps: number, creatorTaxBps: number): number {
  // Pons: 1% trade fee, 70% of it to the creator-fee recipient; the creator
  // tax is charged on top and goes to the same recipient.
  const feeToChestBps = 100 * 0.7 + creatorTaxBps;
  const { creator } = splitPct(burnBps);
  return (feeToChestBps * creator) / 100;
}

export function days(seconds: number): number {
  return Math.round(seconds / DAY);
}

export function formatLock(seconds: number): string {
  if (seconds === 0) return "no lock";
  const d = seconds / DAY;
  if (d < 1) return `${Math.round(seconds / 3600)} h`;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} days`;
}

export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/**
 * The rules read back as sentences — what the chest page and the launch
 * form's "read it back" panel both print.
 */
export function readBack(r: Rules, opts: { launchAt?: number; graduated?: boolean } = {}): { key: string; text: string }[] {
  const lines: { key: string; text: string }[] = [];
  const pct = splitPct(r.burnBps, opts.graduated);
  if (r.firstBuyWei === 0n) {
    lines.push({ key: "allocation", text: "No allocation: the creator buys nothing at launch. The chest holds no tokens." });
  } else if (r.lockSeconds === 0) {
    lines.push({ key: "allocation", text: "The creator's first buy goes straight to their wallet. No lock." });
  } else {
    const end = opts.launchAt ? new Date((opts.launchAt + r.lockSeconds) * 1000) : null;
    lines.push({
      key: "allocation",
      text: `The creator's first buy is delivered to the chest and unlocks linearly over ${formatLock(r.lockSeconds)}${end ? `, fully unlocked ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}. Anyone can trigger an unlock; it always pays the creator.`,
    });
  }
  lines.push({
    key: "loot",
    text: `Every opening splits the loot: ${pct.opener}% to whoever opens it, ${pct.pad}% to ${site.name}, ${pct.burn > 0 ? `${pct.burn}% bought back and burned, ` : ""}${pct.creator}% to the creator.`,
  });
  if (r.burnBps > 0) {
    lines.push({
      key: "burn",
      text: opts.graduated
        ? "The curve has graduated: the burn rule has ended and the creator's share is the full remainder."
        : `The burn share buys the token on the curve and sends it to the dead address, at most ${site.burnSliceBps / 100}% of the curve's reserve per hour. It ends when the curve graduates; anything still waiting is then burned as ETH.`,
    });
  }
  lines.push({
    key: "fee",
    text:
      r.creatorTaxBps === 0
        ? `No creator fee. The chest earns ${site.creatorFeeSharePct}% of Pons' ${site.tradeFeePct} trade fee.`
        : `A ${formatBps(r.creatorTaxBps)} creator fee on every trade, on top of Pons' ${site.tradeFeePct}, goes to the chest too.`,
  });
  return lines;
}
