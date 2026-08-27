// Yoco (South Africa) — the first real card-provider implementation.
// Same graceful-degradation pattern as WhatsApp/R2/Anthropic: without a
// configured secret key it logs and returns a stub success rather than
// failing, so checkout works end-to-end in dev/demo before real
// credentials exist.

import type { PosCardProvider, PosChargeResult } from "./types";

export function createYocoProvider(apiKey: string | null): PosCardProvider {
  return {
    async charge(amountCents, meta): Promise<PosChargeResult> {
      if (!apiKey) {
        console.warn(`[pos:yoco:stub] would charge ${amountCents} cents`, meta);
        return { ok: true, reference: `stub_${Date.now()}` };
      }

      const res = await fetch("https://payments.yoco.com/api/checkouts", {
        method: "POST",
        headers: {
          "X-Auth-Secret-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: amountCents, currency: "ZAR", metadata: meta }),
      });

      if (!res.ok) {
        return { ok: false, error: `Yoco charge failed: ${res.status}` };
      }
      const data = await res.json();
      return { ok: true, reference: data.id };
    },
  };
}
