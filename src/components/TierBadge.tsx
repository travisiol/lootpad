import { TIERS, type Tier } from "@/lib/rules";

/** The rarity pill. The colour is the tier; the word is the only text. */
export function TierBadge({ tier, className = "", title }: { tier: Tier; className?: string; title?: string }) {
  return (
    <span className={`tier tier-${tier} ${className}`} title={title ?? TIERS[tier].requirement}>
      {TIERS[tier].name}
    </span>
  );
}
