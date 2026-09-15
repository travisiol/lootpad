import type { Metadata } from "next";
import Link from "next/link";
import { FAQ } from "@/components/landing/Faq";
import { TierBadge } from "@/components/TierBadge";
import { SplitBar } from "@/components/SplitBar";
import { TIERS, TIER_ORDER } from "@/lib/rules";
import { site, percent } from "@/lib/site";
import { ROUTER_ADDRESS } from "@/lib/contracts";
import { explorer } from "@/lib/chain";

export const metadata: Metadata = {
  title: "How it works",
  description: "What a chest is, what the router does, how the loot is split, how tiers are earned, and what LOOTPAD takes.",
};

const H = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="display scroll-mt-28 text-[24px] text-ink sm:text-[28px]">
    {children}
  </h2>
);

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="lg:sticky lg:top-24 lg:self-start" aria-label="On this page">
          <p className="label mb-3">On this page</p>
          <ul className="space-y-2 text-sm text-ink-2">
            {[
              ["chest", "The chest"],
              ["launch", "Launching"],
              ["allocation", "The allocation"],
              ["loot", "The loot"],
              ["burn", "The burn"],
              ["tiers", "Tiers"],
              ["pad", `What ${site.name} takes`],
              ["contracts", "Contracts"],
              ["faq", "Questions"],
            ].map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="min-w-0 space-y-12">
          <header>
            <p className="eyebrow">How it works</p>
            <h1 className="display mt-4 text-[34px] text-ink sm:text-[44px]">A chest is a contract with no owner.</h1>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2">
              {site.name} launches tokens on {site.venue}, the bonding-curve launchpad on {site.chain}, and wires one Chest
              contract into every launch. The chest receives the token&apos;s creator fees and — when the creator chose a lock —
              the creator&apos;s own first buy. What it does with both is fixed in the launch transaction and can be read back
              from the chain by anyone, forever.
            </p>
          </header>

          <div className="space-y-4">
            <H id="chest">The chest</H>
            <p className="text-[15px] leading-relaxed text-ink-2">
              Pons V2 gives a launch two programmable surfaces: the address that receives the creator fees, and the address that
              receives the developer&apos;s first buy. {site.name} points both at one small contract per launch — the chest — and
              the chest applies the rules. There is no admin function on a chest. The router names its token and curve once;
              after that the only things anyone can do are open it, unlock it, and (the creator) hand the creator role to another
              address in two steps.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["The token", "Name, ticker, image and description, stored in the router so the site needs no indexer, and launched on a fresh Pons curve paired with ETH."],
                ["The allocation", "The creator's first buy. With a lock it is held by the chest and unlocks linearly; without one it goes to the creator's wallet and the chest holds nothing."],
                ["The rules", `The burn share, the creator fee, the lock — plus the two shares every chest has: ${percent.opener} to the opener, ${percent.pad} to the pad.`],
              ].map(([t, b]) => (
                <div key={t} className="panel p-4">
                  <p className="display text-[16px] text-ink">{t}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{b}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <H id="launch">Launching</H>
            <p className="text-[15px] leading-relaxed text-ink-2">
              <Link href="/launch" className="text-gold hover:underline">
                Open a chest
              </Link>{" "}
              is one transaction to the router, worth Pons&apos; launch fee ({site.launchFeeEth} ETH) plus your first buy. The
              router deploys your chest, then launches on Pons through its forwarder with the chest as creator-fee recipient. If
              you chose a lock, the chest is also the recipient of the first buy, so the tokens never touch your wallet; if not,
              the first buy goes to you. Then the router arms the chest with the token and curve addresses, records the launch,
              and emits <span className="mono text-ink">Launched</span>. The site decodes that event and opens the chest on
              screen.
            </p>
            <p className="text-[15px] leading-relaxed text-ink-2">
              Two consequences of that wiring are worth knowing. Pons exempts the launcher (the router) and the fee recipient (the
              chest) from its snipe tax, and the forwarder exempts the buy recipient. With a lock, that is the chest — so your own
              wallet pays the snipe tax like everyone else&apos;s. Without a lock, the buy recipient is your wallet, which Pons
              exempts as it would on any launch.
            </p>
          </div>

          <div className="space-y-4">
            <H id="allocation">The allocation</H>
            <p className="text-[15px] leading-relaxed text-ink-2">
              A locked allocation unlocks linearly from the launch block over the chosen duration ({site.lockDays.min} to{" "}
              {site.lockDays.max} days). At any moment the chest can say how much is still inside, how much is unlockable and how
              much has been paid out; the chest page shows it as a bar, and the 3D chest&apos;s lid follows it. Anyone can call{" "}
              <span className="mono text-ink">unlock()</span>; it always pays the creator. A lock without a first buy is refused by
              the router, because there would be nothing to lock.
            </p>
          </div>

          <div className="space-y-4">
            <H id="loot">The loot</H>
            <p className="text-[15px] leading-relaxed text-ink-2">
              Every trade on the curve pays Pons&apos; {site.tradeFeePct} fee; {site.creatorFeeSharePct}% of it belongs to the
              creator-fee recipient, and a creator fee, if set, is charged on top and goes to the same place. Those fees wait on
              the curve until Pons sweeps them into its escrow, credited to the chest. Anyone can then call{" "}
              <span className="mono text-ink">open()</span>: the chest claims the escrow and splits what came out — the key and
              the pad first, then the burn share of the rest, then the remainder to the creator.
            </p>
            <div className="panel p-4">
              <p className="text-[13px] text-ink-3">A chest with a 25% burn share, for example:</p>
              <SplitBar burnBps={2500} className="mt-3" />
            </div>
          </div>

          <div className="space-y-4">
            <H id="burn">The burn</H>
            <p className="text-[15px] leading-relaxed text-ink-2">
              The burn share is not paid to anyone: the chest spends it buying the token on its own curve and sends what it bought
              to the dead address. Because <span className="mono text-ink">open()</span> is public, a large buyback in one call
              could be sandwiched, so the burn is sliced: at most {site.burnSliceBps / 100}% of the curve&apos;s quote reserve per
              opening, and openings at least an hour apart burn; the rest waits in the chest as a reserve. The rule lives on the
              curve, and a graduated curve cannot be bought from — so the burn share is zero from the first opening that sees
              graduation, and any reserve still waiting is sent to the dead address as ETH.
            </p>
          </div>

          <div className="space-y-4">
            <H id="tiers">Tiers</H>
            <p className="text-[15px] leading-relaxed text-ink-2">
              A chest&apos;s rarity is computed from its own rules — the lock, the burn share, the creator fee — by one function the
              whole site shares. It cannot be picked or bought. A launch with no first buy counts as locked for the purpose of a
              tier, since there is nothing to lock; it does not mean the creator holds nothing, only that the chest gave them
              nothing at launch.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {TIER_ORDER.map((t) => (
                <div key={t} className="panel p-4">
                  <TierBadge tier={t} />
                  <p className="mt-3 text-[13px] text-ink">{TIERS[t].requirement}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <H id="pad">What {site.name} takes</H>
            <p className="text-[15px] leading-relaxed text-ink-2">
              {percent.pad} of every opening, taken by the chest itself and sent to the pad&apos;s treasury. That is the only
              revenue. There is no fee at launch beyond Pons&apos; own {site.launchFeeEth} ETH; the router&apos;s owner can set one,
              and the launch form reads the live total, which is zero. The owner can also pause new launches and move the treasury
              address — and can never touch a chest that exists.
            </p>
          </div>

          <div className="space-y-4">
            <H id="contracts">Contracts</H>
            <ul className="space-y-2 text-sm text-ink-2">
              <li className="mono text-xs">
                LootpadRouter ·{" "}
                {ROUTER_ADDRESS ? (
                  <a href={explorer.address(ROUTER_ADDRESS)} target="_blank" rel="noreferrer" className="text-ink hover:text-gold">
                    {ROUTER_ADDRESS}
                  </a>
                ) : (
                  <span className="text-ink-3">awaiting deployment</span>
                )}
              </li>
              <li className="mono text-xs text-ink-3">Pons V2 factory · 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e</li>
              <li className="mono text-xs text-ink-3">Pons fee escrow · 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e</li>
              <li className="mono text-xs text-ink-3">Chain · Robinhood Chain (4663) · rpc.mainnet.chain.robinhood.com</li>
            </ul>
            <p className="text-[13px] leading-relaxed text-ink-3">
              Source, tests on a mock Pons and a rehearsal against the real factory on a fork of Robinhood Chain are in the
              repository&apos;s <span className="mono">contracts/</span> folder. Each chest is a separate contract created by the
              ChestFactory in the launch transaction; its address is on its page.
            </p>
          </div>

          <div className="space-y-4">
            <H id="faq">Questions</H>
            <div className="divide-y divide-edge-ink border-y border-edge-ink">
              {FAQ.map((f) => (
                <div key={f.q} className="py-5">
                  <p className="text-[16px] text-ink">{f.q}</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-3">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
