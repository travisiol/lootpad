"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChestsResponse } from "@/lib/pons";
import { ROUTER_ADDRESS } from "@/lib/contracts";
import { ChestCard } from "@/components/ChestCard";

/**
 * The shelf: chests launched through the router, newest first, read by the
 * visitor's browser through /api/chests. Empty is a real empty — no sample
 * set, no placeholder chests.
 */
export function ChestList({ limit = 24, compact = false }: { limit?: number; compact?: boolean }) {
  const [data, setData] = useState<ChestsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/chests?limit=${limit}`)
        .then((r) => r.json() as Promise<ChestsResponse>)
        .then((j) => {
          if (!alive) return;
          setData(j);
          setFailed(!j.ok);
        })
        .catch(() => alive && setFailed(true));
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [limit]);

  if (!data && !failed) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: compact ? 3 : 6 }).map((_, i) => (
          <div key={i} className="skeleton h-[286px] rounded-[20px]" />
        ))}
      </div>
    );
  }

  const chests = data?.chests ?? [];
  if (chests.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-3 px-6 py-14 text-center">
        <p className="display text-[22px] text-ink">{failed ? "The chain did not answer." : "No chest has been opened yet."}</p>
        <p className="max-w-md text-sm text-ink-3">
          {failed
            ? "The shelf reads Robinhood Chain directly and the read failed. It retries on its own."
            : ROUTER_ADDRESS
              ? "The router is live and the shelf is empty. The first chest could be yours."
              : "The router is awaiting deployment; until then nothing can be launched through it and the shelf reads empty."}
        </p>
        {!failed ? (
          <Link href="/launch" className="btn btn-gold btn-sm mt-2">
            Open a chest
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {chests.map((c) => (
        <ChestCard key={c.token} chest={c} readAt={data?.readAt} />
      ))}
    </div>
  );
}
