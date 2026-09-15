"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChestScene } from "@/components/ChestScene";
import { LiveCount } from "@/components/LiveCount";
import { ROUTER_ADDRESS } from "@/lib/contracts";
import { site } from "@/lib/site";

/**
 * Six things: the hook, one sentence, two buttons, the status line and the
 * chest. The chest opens on its own a beat after the page lands, and
 * anyone can click it shut and open again.
 */
export function Hero() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="mx-auto grid max-w-7xl items-center gap-6 px-4 pb-10 pt-8 sm:px-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:gap-10 lg:pt-4">
      <div className="order-2 lg:order-1">
        <h1 className="display text-[44px] leading-[1.05] text-ink sm:text-[60px] lg:text-[64px]">
          {site.hook.map((word, i) => (
            <span key={word} className={`block ${i === 2 ? "text-gold" : ""}`}>
              {word}
            </span>
          ))}
        </h1>
        <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-2">
          A launchpad where every launch is a chest. The token, its allocation and its rules are sealed in a contract with no
          owner — and revealed when it opens.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/launch" className="btn btn-gold">
            Open a chest
          </Link>
          <Link href="/chests" className="btn btn-glass">
            See the chests
          </Link>
        </div>
        <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
          <span className="inline-flex items-baseline gap-2">
            <LiveCount /> <span>chests opened</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {site.venue} on {site.chain}
          </span>
          {!ROUTER_ADDRESS ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="pill">awaiting launch</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="order-1 lg:order-2">
        <ChestScene open={open} interactive onToggle={setOpen} framing="hero" className="mx-auto aspect-[5/4] w-full max-w-[640px]" />
        <p className="mt-1 text-center text-xs text-ink-4">Click the chest.</p>
      </div>
    </section>
  );
}
