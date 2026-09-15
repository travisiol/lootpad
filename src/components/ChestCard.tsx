"use client";

import Link from "next/link";
import type { ChestItem } from "@/lib/pons";
import { formatCap, formatGraduation, formatWei } from "@/lib/format";
import { formatBps, formatLock, splitPct } from "@/lib/rules";
import { TierBadge } from "@/components/TierBadge";
import { TokenLogo } from "@/components/TokenLogo";
import { ChestMark } from "@/components/ChestMark";
import { useNow } from "@/lib/useNow";

/**
 * One chest on the shelf. The lid tilts on hover; the four numbers are the
 * rules and the market, nothing else.
 */
export function ChestCard({ chest, readAt }: { chest: ChestItem; readAt?: number }) {
  const now = useNow(readAt);
  const m = chest.market;
  const s = chest.status;
  const allocation = BigInt(s.allocation);
  const lockPct = chest.lockDuration > 0 && s.lockEnd > 0 ? Math.min(100, Math.max(0, ((now - s.launchedAt) / chest.lockDuration) * 100)) : 100;
  const split = splitPct(chest.burnBps, s.graduated);
  return (
    <Link href={`/chest/${chest.token}`} className="group glass block p-5 transition-colors hover:border-edge-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenLogo logo={chest.logo} symbol={chest.symbol} size={44} />
          <div className="min-w-0">
            <p className="display truncate text-[17px] text-ink">{chest.name}</p>
            <p className="mono truncate text-xs text-ink-3">${chest.symbol}</p>
          </div>
        </div>
        <TierBadge tier={chest.tier} />
      </div>

      <div className="relative mt-4 flex h-24 items-end justify-center overflow-hidden rounded-[12px] border border-edge-ink bg-black/25">
        <div className="absolute inset-x-0 bottom-0 h-16 bg-[radial-gradient(60%_80%_at_50%_100%,rgba(155,109,255,0.28),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true" />
        <ChestMark className="relative h-20 w-20 transition-transform duration-500 group-hover:-translate-y-1" open={false} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
        <div>
          <dt className="text-ink-4">Market cap</dt>
          <dd className="mono text-ink">{formatCap(m.marketCapUsd, m.marketCapEth)}</dd>
        </div>
        <div>
          <dt className="text-ink-4">Graduation</dt>
          <dd className="mono text-ink">{formatGraduation(m.graduationProgressPct, m.graduated)}</dd>
        </div>
        <div>
          <dt className="text-ink-4">Allocation</dt>
          <dd className="mono text-ink">
            {allocation > 0n ? (
              <>
                {chest.allocationPct.toFixed(2)}% · {lockPct >= 100 ? "unlocked" : `${Math.floor(lockPct)}% out`}
              </>
            ) : BigInt(chest.firstBuy) > 0n ? (
              "in wallet"
            ) : (
              "none"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-4">Loot rule</dt>
          <dd className="mono text-ink">
            {split.creator}% creator{split.burn > 0 ? ` · ${split.burn}% burn` : ""}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-4">
        lock {formatLock(chest.lockDuration)} · fee {formatBps(chest.creatorTaxBps)} · loot out {formatWei(s.totalLoot, 4)} ETH · {s.openings} opening{s.openings === 1 ? "" : "s"}
      </p>
    </Link>
  );
}
