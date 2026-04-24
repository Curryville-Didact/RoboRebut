import type { Metadata } from "next";
import { PricingPageClient } from "@/components/pricing/PricingPageClient";

export const metadata: Metadata = {
  title: "Pricing | RoboRebut",
  description: "Live-call objection handling plans for reps and teams.",
};

export default function PricingPage() {
  return <PricingPageClient />;
}
