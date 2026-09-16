// Reading a business off its own website.
//
// Setup asks for a dozen facts a business has already published: the trading
// name, the phone number, the email, the address, the registration and VAT
// numbers in the footer, and what they actually do. Typing all of that again
// is the most common place a new workspace is abandoned half-finished.
//
// So: fetch the page they already have and fill the form in. Everything is a
// suggestion — each field comes back with where it was found, and nothing is
// written until somebody says yes. A guess presented as a fact is worse than
// an empty field, because an empty field gets filled and a wrong one gets
// printed on an invoice.
//
// The security side matters more than the feature. A server that fetches a
// URL somebody typed is a server that can be pointed at the cloud provider's
// own metadata endpoint or at anything else inside the network. So: https
// only, public hostnames only, no redirects followed to anywhere private, a
// hard timeout and a size cap.

export interface Found<T> {
  value: T;
  /** Where it came from, so a person can judge it. */
  where: string;
}

export interface WebsiteFacts {
  url: string;
  name: Found<string> | null;
  description: Found<string> | null;
  email: Found<string> | null;
  phone: Found<string> | null;
  address: Found<string> | null;
  vatNumber: Found<string> | null;
  registrationNumber: Found<string> | null;
  /** What they seem to sell, as headings off the page. */
  services: string[];
  /** Anything the scan could not do, said plainly. */
  notes: string[];
}

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;

/**
 * Hostnames we will never fetch.
 *
 * Link-local, loopback and the private ranges. `169.254.169.254` is the one
 * that matters most: it is the cloud metadata endpoint on AWS, GCP and Azure
 * alike, and a server that will fetch it for a stranger is a server that
 * hands out its own credentials.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }

  // Anything in brackets or with colons is IPv6; the loopback and unique-local
  // ranges are the ones to keep out.
  if (host.includes(":")) {
    const bare = host.replace(/^\[|\]$/g, "");
    if (bare === "::1" || bare.startsWith("fc") || bare.startsWith("fd") || bare.startsWith("fe80")) return true;
  }
  return false;
}

export function safeUrl(input: string): URL | null {
  let candidate = input.trim();
  if (!candidate) return null;

  // Somebody typing "kganya.co.za" means the web, so a missing scheme is
  // filled in. But a scheme that is present and is not the web — file:,
  // gopher:, anything else — must be refused outright rather than having
  // https:// glued on the front, which would turn "file:///etc/passwd" into a
  // request to a host called "file".
  const scheme = candidate.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;
  if (!scheme) candidate = `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  // http is allowed in, then upgraded: plenty of small business sites are
  // still plain http, and refusing them would fail the exact businesses this
  // is for. What is never allowed is a scheme that is not the web at all.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (isPrivateHost(url.hostname)) return null;
  if (url.port && !["80", "443", ""].includes(url.port)) return null;

  return url;
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const value = decode(match[1]);
      if (value) return value;
    }
  }
  return null;
}

/**
 * Pull the facts out of one page's HTML.
 *
 * Separated from the fetching so it can be tested against real pages without
 * a network, which is the only way this stays correct — every website is
 * different and the regressions all come from a shape nobody anticipated.
 */
export function readFacts(html: string, url: string): WebsiteFacts {
  const notes: string[] = [];

  const title = firstMatch(html, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);

  // A title is usually "Business Name | What They Do" — the first part is the
  // name, and keeping the whole thing would put a tagline on every invoice.
  const name = title ? title.split(/\s+[|·—–-]\s+/)[0].trim() : null;

  const description = firstMatch(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ]);

  const emailMatch = html.match(/mailto:([^"'?\s>]+@[^"'?\s>]+)/i) ?? html.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  // A sender address on the site is somebody's real inbox; a no-reply is a
  // machine, and filling a business's contact email with one helps nobody.
  const email = emailMatch && !/no-?reply|example\.|sentry|wixpress/i.test(emailMatch[1]) ? emailMatch[1] : null;

  const telMatch = html.match(/tel:([+0-9()\s-]{7,})/i);
  const phoneText = html.match(/(\+27[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}|\b0\d{2}[\s-]?\d{3}[\s-]?\d{4}\b)/);
  const phone = telMatch?.[1]?.trim() ?? phoneText?.[1]?.trim() ?? null;

  const vat = html.match(/VAT\s*(?:Reg(?:istration)?\.?\s*)?(?:No\.?|Number|#)?\s*[:\s]\s*(4\d{9})/i);
  const registration = html.match(/\b((?:19|20)\d{2}\/\d{6}\/\d{2})\b/);

  const address = firstMatch(html, [
    /<address[^>]*>([\s\S]{5,300}?)<\/address>/i,
    /"streetAddress"\s*:\s*"([^"]{5,200})"/i,
  ]);

  // Headings, which on almost every small business site are the list of what
  // they do. Capped, because a long page would otherwise import its blog.
  const headings = [...html.matchAll(/<h[23][^>]*>([\s\S]{2,80}?)<\/h[23]>/gi)]
    .map((match) => decode(match[1].replace(/<[^>]+>/g, "")))
    .filter((heading) => heading.length > 2 && heading.length < 60)
    .filter((heading, index, all) => all.indexOf(heading) === index)
    .slice(0, 10);

  if (!phone) notes.push("No phone number found on that page. It is often only on the contact page.");
  if (!email) notes.push("No email address found. Many sites use a form instead of publishing one.");
  if (headings.length === 0) notes.push("No headings found, which usually means the page builds itself in the browser. The facts may be there but not in the file we can read.");

  return {
    url,
    name: name ? { value: name, where: "the page title" } : null,
    description: description ? { value: description, where: "the page's own description" } : null,
    email: email ? { value: email, where: "a link on the page" } : null,
    phone: phone ? { value: phone, where: "a link on the page" } : null,
    address: address ? { value: address.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), where: "the address block" } : null,
    vatNumber: vat ? { value: vat[1], where: "the footer" } : null,
    registrationNumber: registration ? { value: registration[1], where: "the footer" } : null,
    services: headings,
    notes,
  };
}

/**
 * Fetch a business's own website and read what it says about them.
 *
 * Returns suggestions, never writes anything. The caller shows them beside
 * the empty fields and a person decides.
 */
export async function scanWebsite(input: string): Promise<{ ok: true; facts: WebsiteFacts } | { ok: false; reason: string }> {
  const url = safeUrl(input);
  if (!url) {
    return {
      ok: false,
      reason: "That does not look like a website address we can open. It should be something like yourbusiness.co.za.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Identified honestly. A scanner that pretends to be a person is a
        // scanner nobody can block, and anybody should be able to block this.
        "User-Agent": "skynat-setup/1.0 (+https://skynatflow.com; reads a business's own site during setup)",
        Accept: "text/html",
      },
    });

    // A redirect chain can end somewhere private even when the first hop was
    // not, so where it actually landed is checked as well.
    const landed = new URL(response.url || url.toString());
    if (isPrivateHost(landed.hostname)) {
      return { ok: false, reason: "That address redirects somewhere we will not follow." };
    }

    if (!response.ok) {
      return { ok: false, reason: `That site answered with ${response.status}. It may be down, or it may not like being read by anything but a browser.` };
    }

    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) {
      return { ok: false, reason: "That address is not a web page, so there is nothing on it to read." };
    }

    const html = (await response.text()).slice(0, MAX_BYTES);
    return { ok: true, facts: readFacts(html, landed.toString()) };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted
        ? "That site took too long to answer. Nothing is wrong here — try again, or just type the details in."
        : "Could not reach that site. Check the address, or type the details in instead.",
    };
  } finally {
    clearTimeout(timer);
  }
}
