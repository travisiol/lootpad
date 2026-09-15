/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { ChestScene } from "@/components/ChestScene";
import { TokenLogo } from "@/components/TokenLogo";
import { TierBadge } from "@/components/TierBadge";
import { SplitBar } from "@/components/SplitBar";
import { CopyButton } from "@/components/CopyButton";
import { explorer } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { formatBps, formatLock, tierOf, type Rules } from "@/lib/rules";
import { site } from "@/lib/site";

type Props = {
  token: `0x${string}`;
  chest: `0x${string}`;
  hash: `0x${string}`;
  name: string;
  symbol: string;
  logo: string | null;
  rules: Rules;
  allocationPct: number;
  allocationTokens: bigint;
};

/**
 * The reveal. The chest opens, and what was sealed in the transaction
 * rises out of it in three cards — token, allocation, rules — in the same
 * order the form filled them.
 */
export function Reveal({ token, chest, hash, name, symbol, logo, rules, allocationPct, allocationTokens }: Props) {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState(false);
  useEffect(() => {
    // The form was scrolled to its button; the chest is at the top.
    window.scrollTo({ top: 0, behavior: "smooth" });
    const a = setTimeout(() => setOpen(true), 500);
    const b = setTimeout(() => setCards(true), 1300);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  const tier = tierOf(rules);
  const shareText = encodeURIComponent(`$${symbol} — ${name}. A ${tier} chest on ${site.name}: ${rules.lockSeconds > 0 ? `allocation locked ${formatLock(rules.lockSeconds)}, ` : ""}${rules.burnBps > 0 ? `${rules.burnBps / 100}% of the loot burned, ` : ""}rules sealed onchain.`);
  const shareUrl = encodeURIComponent(`${site.url}/chest/${token}`);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="relative">
        <ChestScene open={open} framing="hero" className="mx-auto aspect-[5/4] w-full max-w-[620px]" />
        {cards ? <div className="reveal-beam pointer-events-none absolute left-1/2 top-0 h-[70%] w-40 -translate-x-1/2" aria-hidden="true" /> : null}
      </div>
      <div className="-mt-10 text-center">
        <p className="eyebrow">Opened</p>
        <h1 className="display mt-3 text-[32px] text-ink sm:text-[40px]">
          {name} <span className="text-ink-3">·</span> <span className="text-gold">${symbol}</span>
        </h1>
        <p className="mt-2 text-sm text-ink-3">Sealed in one transaction. Read back from the chain.</p>
      </div>

      {cards ? (
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <article className="reveal-card glass p-5" style={{ "--delay": "0ms" } as React.CSSProperties}>
            <p className="label">01 · The token</p>
            <div className="mt-4 flex items-center gap-3">
              {logo ? <img src={logo} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <TokenLogo logo={null} symbol={symbol} size={48} />}
              <div className="min-w-0">
                <p className="display truncate text-[18px] text-ink">{name}</p>
                <p className="mono text-xs text-ink-3">${symbol}</p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-3">Contract</dt>
                <dd className="mono flex items-center gap-1 text-ink">
                  <a href={explorer.token(token)} target="_blank" rel="noreferrer" className="hover:text-gold">
                    {shortAddress(token)}
                  </a>
                  <CopyButton value={token} variant="icon" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-3">Chest</dt>
                <dd className="mono flex items-center gap-1 text-ink">
                  <a href={explorer.address(chest)} target="_blank" rel="noreferrer" className="hover:text-gold">
                    {shortAddress(chest)}
                  </a>
                  <CopyButton value={chest} variant="icon" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-3">Venue</dt>
                <dd className="text-ink">{site.venue} · ETH pair</dd>
              </div>
            </dl>
          </article>

          <article className="reveal-card glass p-5" style={{ "--delay": "220ms" } as React.CSSProperties}>
            <p className="label">02 · The allocation</p>
            {rules.firstBuyWei === 0n ? (
              <>
                <p className="display mt-4 text-[26px] text-ink">None</p>
                <p className="mt-2 text-sm text-ink-3">No first buy. The chest holds no tokens; the creator starts with the market.</p>
              </>
            ) : (
              <>
                <p className="display mt-4 text-[26px] text-gold">≈ {allocationPct.toFixed(2)}%</p>
                <p className="mt-1 text-sm text-ink-3">
                  of the supply, for {formatEther(rules.firstBuyWei)} ETH — about {Math.round(Number(formatEther(allocationTokens))).toLocaleString("en-US")} tokens.
                </p>
                <p className="mt-3 text-sm text-ink">
                  {rules.lockSeconds > 0
                    ? `Held by the chest. Unlocks linearly over ${formatLock(rules.lockSeconds)}, from now.`
                    : "Delivered to the creator's wallet. No lock."}
                </p>
              </>
            )}
          </article>

          <article className="reveal-card glass p-5" style={{ "--delay": "440ms" } as React.CSSProperties}>
            <div className="flex items-center justify-between gap-3">
              <p className="label">03 · The rules</p>
              <TierBadge tier={tier} />
            </div>
            <SplitBar burnBps={rules.burnBps} className="mt-4" />
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Burn</dt>
                <dd className="text-ink">{rules.burnBps > 0 ? `${rules.burnBps / 100}% of the loot, until graduation` : "none"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Creator fee</dt>
                <dd className="text-ink">{formatBps(rules.creatorTaxBps)} per trade</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Opener&apos;s key</dt>
                <dd className="text-ink">{site.openerShareBps / 100}% of every opening</dd>
              </div>
            </dl>
          </article>
        </div>
      ) : null}

      {cards ? (
        <div className="fade-in mt-8 flex flex-col items-center gap-3" style={{ animationDelay: "700ms" }}>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={`/chest/${token}`} className="btn btn-gold">
              Go to the chest
            </Link>
            <a href={`https://x.com/intent/tweet?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noreferrer" className="btn btn-glass">
              Share on X
            </a>
          </div>
          <a href={explorer.tx(hash)} target="_blank" rel="noreferrer" className="mono break-all text-xs text-ink-4 hover:text-ink">
            {hash}
          </a>
        </div>
      ) : null}
    </div>
  );
}
