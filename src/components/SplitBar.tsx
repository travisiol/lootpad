import { splitPct } from "@/lib/rules";
import { site } from "@/lib/site";

/**
 * One bar, four segments: how every opening of a chest is split. The
 * legend prints the same numbers the contract uses.
 */
export function SplitBar({ burnBps, graduated = false, legend = true, className = "" }: { burnBps: number; graduated?: boolean; legend?: boolean; className?: string }) {
  const s = splitPct(burnBps, graduated);
  const parts = [
    { key: "creator", label: "creator", pct: s.creator, cls: "split-creator" },
    { key: "burn", label: "burned", pct: s.burn, cls: "split-burn" },
    { key: "pad", label: site.name, pct: s.pad, cls: "split-pad" },
    { key: "opener", label: "opener", pct: s.opener, cls: "split-opener" },
  ].filter((p) => p.pct > 0);
  return (
    <div className={className}>
      <div className="split" role="img" aria-label={parts.map((p) => `${p.label} ${p.pct}%`).join(", ")}>
        {parts.map((p) => (
          <span key={p.key} className={p.cls} style={{ width: `${p.pct}%` }} />
        ))}
      </div>
      {legend ? (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
          {parts.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-sm ${p.cls}`} aria-hidden="true" />
              <span className="mono text-ink">{p.pct}%</span> {p.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
