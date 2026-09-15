import type { Metadata } from "next";
import { LaunchForm } from "@/components/LaunchForm";

export const metadata: Metadata = {
  title: "Open a chest",
  description: "Fill the chest — token, allocation, rules — and open it: one transaction launches on Pons V2 with a Chest contract wired in.",
};

export default function LaunchPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <LaunchForm />
    </section>
  );
}
