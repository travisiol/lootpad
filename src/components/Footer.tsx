import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { site } from "@/lib/site";
import { ROUTER_ADDRESS } from "@/lib/contracts";
import { explorer } from "@/lib/chain";
import { shortAddress } from "@/lib/format";

export function Footer() {
  return (
    <footer className="mx-auto w-full max-w-7xl px-4 pb-10 pt-20 sm:px-6">
      <div className="rule mb-10" />
      <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-3">
            A launchpad for {site.venue} on {site.chain}. Every launch is a chest: the token, its allocation and its rules are
            sealed in a contract with no owner, and revealed when it opens.
          </p>
        </div>
        <div>
          <p className="label mb-3">Site</p>
          <ul className="space-y-2 text-sm text-ink-2">
            <li><Link href="/launch" className="hover:text-ink">Open a chest</Link></li>
            <li><Link href="/chests" className="hover:text-ink">Chests</Link></li>
            <li><Link href="/docs" className="hover:text-ink">How it works</Link></li>
          </ul>
        </div>
        <div>
          <p className="label mb-3">Contracts</p>
          <ul className="space-y-2 text-sm text-ink-2">
            <li className="mono text-xs">
              Router ·{" "}
              {ROUTER_ADDRESS ? (
                <a href={explorer.address(ROUTER_ADDRESS)} target="_blank" rel="noreferrer" className="hover:text-ink">
                  {shortAddress(ROUTER_ADDRESS)}
                </a>
              ) : (
                <span className="text-ink-3">awaiting deployment</span>
              )}
            </li>
            <li className="mono text-xs text-ink-3">Pons V2 factory · 0x7eD5…EC7e</li>
            <li className="mono text-xs text-ink-3">Chain id · 4663</li>
          </ul>
        </div>
        <div>
          <p className="label mb-3">Elsewhere</p>
          <ul className="space-y-2 text-sm text-ink-2">
            <li><a href={site.x} target="_blank" rel="noreferrer" className="hover:text-ink">X / Twitter</a></li>
            <li><a href="https://www.ponsfamily.com" target="_blank" rel="noreferrer" className="hover:text-ink">Pons</a></li>
          </ul>
        </div>
      </div>
      <div className="mt-10 flex flex-col gap-2 text-xs text-ink-4 sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} {site.name}. Not investment advice. Tokens launched here are created by their creators, not by {site.name}.</span>
        <span className="mono">{site.domain}</span>
      </div>
    </footer>
  );
}
