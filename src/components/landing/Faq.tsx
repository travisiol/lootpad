import { site, percent } from "@/lib/site";

export const FAQ = [
  {
    q: "Is a Legendary chest a safe token?",
    a: `No. A tier says what the creator gave up — how long their allocation is locked, how much of the loot burns, how small their fee is — and nothing about whether the token is worth anything. It reads the chest's own rules; a creator's other wallets are invisible to a contract, and a creator with no first buy can still buy from another wallet after the snipe-tax window. Read the rules, then decide.`,
  },
  {
    q: "Who can open a chest, and why would they?",
    a: `Anyone. Opening pulls the creator fees Pons has swept into its escrow and pays them out by the rules, and ${percent.opener} of what comes out goes to whoever turned the key. A chest with loot in it gets opened because opening pays.`,
  },
  {
    q: `What does ${site.name} earn?`,
    a: `${percent.pad} of every opening, taken by the chest itself and sent to the pad's treasury. Nothing at launch: the ${site.launchFeeEth} ETH launch fee is Pons' own. The router's owner can add a pad launch fee later, and the site will show it if that happens; it is zero.`,
  },
  {
    q: "Where does the loot come from?",
    a: `Every trade on a Pons curve pays a ${site.tradeFeePct} fee; ${site.creatorFeeSharePct}% of it belongs to the creator-fee recipient, which is the chest. A creator fee, if the creator set one, is charged on top and goes to the chest too. Fees wait on the curve until Pons sweeps them to its escrow — the chest page shows what is accruing and what is ready.`,
  },
  {
    q: "What happens to the burn share after graduation?",
    a: `The burn buys the token on the bonding curve, and a graduated curve can no longer be bought from. So the burn rule ends at graduation: from the first opening that sees it, the creator's share is the full remainder, and any burn loot still waiting is sent to the dead address as ETH. It never reaches the creator. The rules card says "until graduation" for exactly this reason.`,
  },
  {
    q: "Can the rules change after launch?",
    a: `No. A chest has no owner and no admin: the router names its token and curve once, in the launch transaction, and the lock, the burn share and the splits are immutable. The router's owner can pause new launches, move the pad's treasury address and set a pad launch fee — never touch an existing chest. The creator can hand their role to another address in two steps, which changes who is paid and nothing else.`,
  },
  {
    q: "Why does the allocation unlock linearly rather than all at once?",
    a: "A cliff invites a dump on the day it ends. A linear unlock means the market watches the allocation come out at a known rate from a known date, and the chest page shows how much is still inside at any moment.",
  },
  {
    q: "Why is the burn sliced?",
    a: `An open call is public, so a big buyback in one go could be sandwiched. Each opening burns at most ${site.burnSliceBps / 100}% of the curve's reserve, and burns are at least an hour apart. Moving the price by p costs an attacker about 2% × p × reserves in fees and wins them at most p × slice, so a slice under 2% cannot be sandwiched at a profit. The rest waits for the next opening.`,
  },
] as const;

export function Faq() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" id="faq">
      <div className="flex flex-col items-center text-center">
        <p className="eyebrow">Questions</p>
        <h2 className="display mt-4 text-[30px] text-ink sm:text-[38px]">The honest answers.</h2>
      </div>
      <div className="mx-auto mt-10 max-w-3xl divide-y divide-edge-ink border-y border-edge-ink">
        {FAQ.map((f) => (
          <details key={f.q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] text-ink">
              {f.q}
              <span className="mono shrink-0 text-ink-4 transition-transform group-open:rotate-45" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-3">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
