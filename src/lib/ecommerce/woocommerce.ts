// WooCommerce REST API client — auth is HTTP Basic with the store's
// consumer key/secret (WooCommerce's own scheme, not OAuth). Two jobs:
// pull the product catalog on demand, and turn a webhook order payload
// into the shape flow's own createQuote/createParty helpers expect.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface WooProduct {
  id: number;
  name: string;
  sku: string;
  price: string; // WooCommerce returns prices as decimal strings
  regular_price: string;
  categories: { name: string }[];
  stock_quantity: number | null;
}

export interface WooOrderLineItem {
  name: string;
  sku: string;
  quantity: number;
  total: string; // line total, decimal string, in the store's currency
}

export interface WooOrder {
  id: number;
  status: string;
  currency: string;
  total: string;
  billing: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  line_items: WooOrderLineItem[];
}

function authHeader(consumerKey: string, consumerSecret: string) {
  const token = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  return `Basic ${token}`;
}

export async function fetchWooProducts(params: {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}): Promise<WooProduct[]> {
  const products: WooProduct[] = [];
  let page = 1;

  // WooCommerce paginates at 100/page max — loop until a short page tells
  // us we've hit the end, so a store with thousands of SKUs still syncs
  // in one call from the UI's point of view.
  for (;;) {
    const url = `${params.storeUrl.replace(/\/$/, "")}/wp-json/wc/v3/products?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: authHeader(params.consumerKey, params.consumerSecret) },
    });
    if (!res.ok) throw new Error(`WooCommerce product fetch failed: ${res.status}`);
    const batch: WooProduct[] = await res.json();
    products.push(...batch);
    if (batch.length < 100) break;
    page++;
    if (page > 50) break; // hard stop — 5000 products is already a lot for one sync click
  }

  return products;
}

// WooCommerce signs webhooks with HMAC-SHA256 of the raw body, base64
// encoded, in the X-WC-Webhook-Signature header. Verifying this is what
// stops anyone who finds the webhook URL from posting fake orders.
export function verifyWooWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function wooPriceToCents(price: string): number {
  const value = Number(price || "0");
  return Math.round(value * 100);
}

// Registers the "new order" webhook via WooCommerce's own REST API so
// connecting a store is genuinely one step — no manual copy-paste of a
// webhook URL/secret into wp-admin. Safe to call again on reconnect:
// WooCommerce just adds another webhook row rather than erroring, which
// is harmless here since the target URL + secret are always the same.
export async function registerWooOrderWebhook(params: {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  deliveryUrl: string;
  secret: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${params.storeUrl.replace(/\/$/, "")}/wp-json/wc/v3/webhooks`, {
    method: "POST",
    headers: {
      Authorization: authHeader(params.consumerKey, params.consumerSecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "flow — new order",
      topic: "order.created",
      delivery_url: params.deliveryUrl,
      secret: params.secret,
    }),
  });
  if (!res.ok) return { ok: false, error: `WooCommerce webhook registration failed: ${res.status}` };
  return { ok: true };
}
