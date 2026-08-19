// Talks to the same Next.js API the owner web app uses — the mobile-facing
// routes under src/app/api/mobile/* in the main platform project. No
// separate backend, no separate business logic: this app is a thin,
// role-specific view over the one shared Business Graph API.
//
// TODO (Phase 0 checkpoint): once Auth.js/session-based login exists, swap
// the hardcoded API_BASE_URL + tenantId-as-query-param approach here for a
// real per-driver login token.

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export interface Delivery {
  quoteId: string;
  partyId: string;
  customerName: string;
  customerPhone: string | null;
  amountCents: number;
}

export async function fetchDeliveries(tenantId: string): Promise<Delivery[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/mobile/deliveries?tenantId=${encodeURIComponent(tenantId)}`
  );
  if (!res.ok) throw new Error(`Failed to load deliveries: ${res.status}`);
  const data = await res.json();
  return data.deliveries;
}

export async function completeDelivery(params: {
  tenantId: string;
  partyId: string;
  quoteId: string;
  gpsLat?: number;
  gpsLng?: number;
  notes?: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/mobile/deliveries/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Failed to mark delivered: ${res.status}`);
}
