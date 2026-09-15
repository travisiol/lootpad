/**
 * Brand and copy that spells the name out. Everything that says "LOOTPAD"
 * reads from here, so a rename is a one-file change.
 */
export const site = {
  name: "LOOTPAD",
  /** The two halves of the wordmark: `LOOT` in gold, `PAD` in ink. */
  wordmark: ["LOOT", "PAD"] as const,
  hook: ["Open.", "Discover.", "Launch."] as const,
  domain: "lootpad.fun",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://lootpad.fun",
  tagline: "Every launch is a chest",
  description:
    "A launchpad for Pons V2 on Robinhood Chain where every launch is a chest: the token, its allocation and its rules are sealed in a contract with no owner and revealed when it opens. Open. Discover. Launch.",
  keywords: ["LOOTPAD", "launchpad", "Robinhood Chain", "Pons V2", "token launch", "chest", "loot", "vesting", "burn"],
  x: process.env.NEXT_PUBLIC_X_URL ?? "https://x.com/lootpad",
  /** The pad's share of every opening, in basis points. */
  padShareBps: 1000,
  /** The opener's share of every opening: the key. */
  openerShareBps: 100,
  /** Bounds enforced by the router, mirrored here for the form. */
  lockDays: { min: 1, max: 365, options: [0, 7, 30, 90, 180] as const, default: 30 },
  burnPct: { options: [0, 25, 50, 75] as const, default: 25 },
  /** Burn mechanics, mirrored from Chest. */
  burnSliceBps: 200,
  burnIntervalHours: 1,
  /** Pons V2 numbers, display only; the chain is the source. */
  graduationEth: 4.2,
  tradeFeePct: "1%",
  creatorFeeSharePct: 70,
  launchFeeEth: process.env.NEXT_PUBLIC_LAUNCH_FEE_ETH ?? "0.0005",
  venue: "Pons V2",
  chain: "Robinhood Chain",
} as const;

export const percent = {
  pad: `${site.padShareBps / 100}%`,
  opener: `${site.openerShareBps / 100}%`,
  /** What is left for the creator's rules once the key and the pad are paid. */
  creatorMax: `${(10_000 - site.padShareBps - site.openerShareBps) / 100}%`,
} as const;
