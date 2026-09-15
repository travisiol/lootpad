import { site, percent } from "@/lib/site";

const STEPS = [
  {
    word: site.hook[0],
    title: "Fill the chest.",
    body: "Name, ticker, image. Then the allocation — your first buy, and how long it takes to unlock — and the rules: your creator fee and how much of the loot is burned. One transaction seals it.",
  },
  {
    word: site.hook[1],
    title: "Everyone sees what is inside.",
    body: "The token, the allocation and the rules are read back from the contract — the same numbers you accepted, on a page anyone can open. The chest's tier says at a glance how much you gave up.",
  },
  {
    word: site.hook[2],
    title: "Live on the curve, loot on every trade.",
    body: `The token trades on ${site.venue}. Every trade's creator fee lands in the chest; anyone can open it, and it pays out by the rules — ${percent.opener} to whoever turned the key.`,
  },
] as const;

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" id="how">
      <div className="flex flex-col items-center text-center">
        <p className="eyebrow">How it works</p>
        <h2 className="display mt-4 text-[30px] text-ink sm:text-[38px]">Three words, one transaction.</h2>
      </div>
      <ol className="mt-10 grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.word} className="glass p-6">
            <div className="flex items-baseline justify-between">
              <span className="display text-[26px] text-gold">{s.word}</span>
              <span className="mono text-xs text-ink-4">0{i + 1}</span>
            </div>
            <p className="display mt-4 text-[18px] text-ink">{s.title}</p>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-3">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
