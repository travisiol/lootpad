import { TIERS, TIER_ORDER } from "@/lib/rules";
import { TierBadge } from "@/components/TierBadge";

/**
 * The rarity ladder. Earned by rules, never rolled: each tier is a floor
 * on what the creator gave up, computed from the chest's own numbers.
 */
export function Tiers() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" id="tiers">
      <div className="flex flex-col items-center text-center">
        <p className="eyebrow">Rarity</p>
        <h2 className="display mt-4 text-[30px] text-ink sm:text-[38px]">Earned by the rules. Never rolled.</h2>
        <p className="mt-3 max-w-xl text-[15px] text-ink-3">
          A chest&apos;s tier is computed from its lock, its burn share and its creator fee — the numbers in the contract, not
          a badge the creator picks. It says how much they gave up, not whether the token is any good.
        </p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIER_ORDER.map((t) => (
          <article key={t} className="glass p-6" style={{ borderColor: `color-mix(in srgb, ${TIERS[t].color} 35%, transparent)` }}>
            <TierBadge tier={t} />
            <p className="mt-4 text-[14px] leading-relaxed text-ink">{TIERS[t].requirement}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{TIERS[t].blurb}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
