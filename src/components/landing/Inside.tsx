import { SplitBar } from "@/components/SplitBar";
import { site, percent } from "@/lib/site";

/**
 * What a chest holds, in three panels — the same three cards that rise
 * out of the chest on the launch page's reveal.
 */
export function Inside() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" id="inside">
      <div className="flex flex-col items-center text-center">
        <p className="eyebrow">What is in a chest</p>
        <h2 className="display mt-4 text-[30px] text-ink sm:text-[38px]">Three things, sealed at launch.</h2>
        <p className="mt-3 max-w-xl text-[15px] text-ink-3">
          A chest is a contract with no owner. What goes in is decided once, in the launch transaction, and read back from the
          chain ever after.
        </p>
      </div>
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <article className="glass p-6">
          <p className="label">01 · The token</p>
          <h3 className="display mt-3 text-[20px] text-ink">Name, ticker, image, story.</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-3">
            Launched on {site.venue} with a fresh bonding curve, paired with ETH. Graduates at {site.graduationEth} ETH into a
            pool, like every Pons token. The chest is its creator-fee recipient from the first block.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2 text-xs">
            {["1e9 supply", `${site.tradeFeePct} trade fee`, `${site.launchFeeEth} ETH launch fee`].map((c) => (
              <li key={c} className="pill">
                {c}
              </li>
            ))}
          </ul>
        </article>
        <article className="glass p-6">
          <p className="label">02 · The allocation</p>
          <h3 className="display mt-3 text-[20px] text-ink">The creator&apos;s first buy, on a schedule.</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-3">
            With a lock, the first buy is delivered to the chest instead of a wallet and unlocks linearly over the days the
            creator chose. Anyone can trigger an unlock; it always pays the creator. Without a lock, it is in the wallet from
            block one — and the chest says so.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2 text-xs">
            {["no lock", "7 days", "30 days", "90 days", "180 days", "custom"].map((c) => (
              <li key={c} className="pill">
                {c}
              </li>
            ))}
          </ul>
        </article>
        <article className="glass p-6">
          <p className="label">03 · The rules</p>
          <h3 className="display mt-3 text-[20px] text-ink">Where the loot goes, every time.</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-3">
            Every opening pays {percent.opener} to whoever opened it and {percent.pad} to {site.name}. Of the rest, the
            creator&apos;s burn share is bought back and burned on the curve; what remains is theirs. The creator fee on trades
            is a rule too.
          </p>
          <SplitBar burnBps={2500} className="mt-4" />
        </article>
      </div>
    </section>
  );
}
