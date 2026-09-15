import Link from "next/link";
import { ChestMark } from "@/components/ChestMark";
import { site } from "@/lib/site";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2.5 ${className}`} aria-label={`${site.name} — home`}>
      <ChestMark className="h-7 w-7" />
      <span className="display-wide text-[15px]">
        <span className="text-gold">{site.wordmark[0]}</span>
        <span className="text-ink">{site.wordmark[1]}</span>
      </span>
    </Link>
  );
}
