// The address this deployment is actually reachable at.
//
// There were fifteen places working this out and four different answers:
// `http://localhost:3000`, `https://skynatflow.com`, an empty string, and —
// in exactly one place — the correct one, read from the request.
//
// Two of those were live bugs rather than untidiness. A customer paying
// through the portal had their return URL AND the provider's notify URL
// built from `http://localhost:3000`, and the notify URL is what settles the
// invoice: the payment would go through and the invoice would stay unpaid
// forever, with nothing in the logs to say why. The payment-gateway settings
// page showed the same localhost address as the webhook to paste into the
// provider's dashboard, which is how it would have been configured wrong in
// the first place.
//
// The order below is deliberate:
//
//   1. NEXT_PUBLIC_APP_URL, because somebody setting it explicitly means it.
//   2. The request's own host, which is the real custom domain and is right
//      even when nobody has configured anything.
//   3. Vercel's own production URL, for work with no request behind it —
//      cron, background jobs — so a deployment is never wrong by default.
//   4. localhost, which is only ever correct on a laptop.
//
// The old fallbacks failed at step 4 with no steps 2 or 3, which is why an
// unconfigured deployment pointed customers at a machine that was not there.

import { headers } from "next/headers";

function clean(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * A setting that is present but blank is not a setting.
 *
 * Found by the test below rather than by thinking: NEXT_PUBLIC_APP_URL set
 * to a few spaces is truthy, so it won the ordering and then cleaned down to
 * an empty string — reproducing exactly the `|| ""` failure this file exists
 * to remove. An env var that somebody cleared by deleting its value, rather
 * than by deleting the variable, is the ordinary way that happens.
 */
function configured(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = clean(value);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The origin, for code with no request to read: cron, scheduled work, tests.
 *
 * Never throws and never returns an empty string — a caller building a URL
 * out of this should not have to check it first.
 */
export function baseUrlWithoutRequest(): string {
  const explicit = configured(process.env.NEXT_PUBLIC_APP_URL);
  if (explicit) return explicit;

  // Set by Vercel on every deployment, so production is correct with no
  // configuration at all. It is the project's own domain rather than the
  // per-deployment one, which is what a customer-facing link needs.
  const production = configured(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (production) return `https://${production}`;

  const deployment = configured(process.env.VERCEL_URL);
  if (deployment) return `https://${deployment}`;

  return "http://localhost:3000";
}

/**
 * The origin, preferring the host the request actually arrived on.
 *
 * Safe to call anywhere: outside a request scope `headers()` throws, and
 * that is caught rather than allowed to take a page down over a URL.
 */
export async function baseUrl(): Promise<string> {
  const explicit = configured(process.env.NEXT_PUBLIC_APP_URL);
  if (explicit) return explicit;

  try {
    const headerList = await headers();
    const host = configured(headerList.get("x-forwarded-host") ?? headerList.get("host") ?? undefined);
    if (host) {
      const proto = headerList.get("x-forwarded-proto") ?? "https";
      return `${proto}://${host}`;
    }
  } catch {
    // No request behind this call. Fall through to the environment.
  }

  return baseUrlWithoutRequest();
}
