import Link from "next/link";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Inside } from "@/components/landing/Inside";
import { Tiers } from "@/components/landing/Tiers";
import { Faq } from "@/components/landing/Faq";
import { ChestList } from "@/components/ChestList";

export default function HomePage() {
  return (
    <>
      <Hero />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="rule" />
      </div>
      <HowItWorks />
      <Inside />
      <Tiers />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" id="latest">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Latest</p>
            <h2 className="display mt-4 text-[30px] text-ink sm:text-[38px]">On the shelf.</h2>
          </div>
          <Link href="/chests" className="btn btn-glass btn-sm">
            All chests
          </Link>
        </div>
        <div className="mt-8">
          <ChestList limit={6} compact />
        </div>
      </section>
      <Faq />
    </>
  );
}
