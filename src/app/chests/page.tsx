import type { Metadata } from "next";
import Link from "next/link";
import { ChestList } from "@/components/ChestList";

export const metadata: Metadata = {
  title: "Chests",
  description: "Every chest opened through the router, newest first, read live from Robinhood Chain.",
};

export default function ChestsPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">The shelf</p>
          <h1 className="display mt-4 text-[34px] text-ink sm:text-[44px]">Chests</h1>
          <p className="mt-2 max-w-lg text-[15px] text-ink-3">
            Newest first, read from the chain every twenty seconds. Open one to see its token, its allocation and its rules.
          </p>
        </div>
        <Link href="/launch" className="btn btn-gold btn-sm">
          Open a chest
        </Link>
      </div>
      <div className="mt-8">
        <ChestList limit={60} />
      </div>
    </section>
  );
}
