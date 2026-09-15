"use client";

import { useEffect, useState } from "react";
import type { ChestsResponse } from "@/lib/pons";

/**
 * The number of chests opened through the router, read from the chain by
 * the visitor's browser. Zero is a real zero — it is what the router says,
 * or what an unconfigured router amounts to. Never seeded.
 */
export function LiveCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/chests?limit=100")
      .then((r) => r.json() as Promise<ChestsResponse>)
      .then((j) => alive && setCount(j.ok ? j.chests.length : 0))
      .catch(() => alive && setCount(0));
    return () => {
      alive = false;
    };
  }, []);
  return count === null ? <span className="skeleton inline-block h-4 w-6" /> : <span className="mono text-ink">{count}</span>;
}
