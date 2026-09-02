"use client";

// Skips the global pricing teaser on /pricing itself, which already has
// its own full CMS-driven pricing section — showing the same three plans
// again right below would just repeat them.

import { usePathname } from "next/navigation";
import PricingCards from "@/components/marketing/PricingCards";

export default function PricingCardsGate() {
  const pathname = usePathname();
  if (pathname === "/pricing") return null;
  return <PricingCards />;
}
