// Provider registry, keyed by region — this is the scaffold that lets a
// new market (USA/Square, Australia/Zeller, Europe/SumUp) be added later
// as one new entry + one new provider file, no changes anywhere else.

import { PosProviderType } from "@prisma/client";
import type { PosCardProvider } from "./types";
import { createYocoProvider } from "./yoco";

export interface PosProviderMeta {
  label: string;
  region: "RSA" | "USA" | "AU" | "EU";
  create: (apiKey: string | null) => PosCardProvider;
}

// Only Yoco has a real implementation today — the rest are named/region-
// tagged placeholders so the settings UI can already list "coming soon"
// entries per region without a code change once a real integration lands.
const STUB_PROVIDER: (label: string) => PosCardProvider = (label) => ({
  async charge(amountCents, meta) {
    console.warn(`[pos:${label}:not-yet-implemented] would charge ${amountCents} cents`, meta);
    return { ok: false, error: `${label} isn't wired up yet — coming soon.` };
  },
});

export const POS_PROVIDERS: Record<PosProviderType, PosProviderMeta> = {
  YOCO: { label: "Yoco", region: "RSA", create: createYocoProvider },
  IKHOKHA: { label: "iKhokha", region: "RSA", create: () => STUB_PROVIDER("iKhokha") },
  SQUARE: { label: "Square", region: "USA", create: () => STUB_PROVIDER("Square") },
  ZELLER: { label: "Zeller", region: "AU", create: () => STUB_PROVIDER("Zeller") },
  GENERIC: { label: "Generic / manual", region: "RSA", create: () => STUB_PROVIDER("Generic") },
};

export function providersForRegion(region: string) {
  return Object.entries(POS_PROVIDERS)
    .filter(([, meta]) => meta.region === region)
    .map(([provider, meta]) => ({ provider: provider as PosProviderType, ...meta }));
}
