import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChestView } from "@/components/ChestView";
import { isAddress, shortAddress } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/chest/[address]">): Promise<Metadata> {
  const { address } = await params;
  return { title: `Chest ${shortAddress(address)}`, description: "The token, its allocation and its rules, read live from Robinhood Chain." };
}

export default async function ChestPage({ params }: PageProps<"/chest/[address]">) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <ChestView token={address} />
    </section>
  );
}
