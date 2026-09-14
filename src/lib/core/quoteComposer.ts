// Typing a quote the way you'd write it on a notepad.
//
// The ask: put the customer at the top, a list of items underneath, and say
// "send this to them". No product picker, no line-item grid, no hunting for a
// customer that may not exist yet.
//
//     Isaac Dlamini
//     isaac@acme.co.za
//     082 555 1234
//
//     2 x iPhone 16 @ R20 000 each
//     1 x AirPods Pro - 4500
//     Installation 1500
//
// Parsing is deliberately deterministic rather than a model call. Three
// reasons, in order of how much they matter:
//
//   1. It has to work when the AI provider is down or out of credit. A quote
//      composer that fails closed is worse than a form.
//   2. Money must not be hallucinated. A model that reads "R20 000" as 2000
//      writes a wrong quote confidently, and the person sees a plausible
//      number rather than an error.
//   3. It is testable without a provider, which is the only way this stays
//      correct as the formats people paste in grow.
//
// `enrichWithModel` exists for genuinely messy prose, and only ever fills in
// what the parser could not read — it never overrides a number the parser
// was sure about.

import { PartyRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createQuote, type QuoteLineInput } from "@/lib/core/money";

export interface ParsedLine {
  description: string;
  quantity: number;
  /** Price of ONE unit, in cents. */
  unitPriceCents: number;
  /** The text this came from, so a person can check what it understood. */
  raw: string;
}

export interface ParsedCustomer {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
}

export interface ParsedQuote {
  customer: ParsedCustomer;
  lines: ParsedLine[];
  /** Things it could not read, in the words of someone who has to fix them. */
  warnings: string[];
}

// ------------------------------------------------------------------ numbers

const CURRENCY = String.raw`(?:R|ZAR|USD|\$|£|€)`;

/**
 * Reads money the way people actually write it here and elsewhere:
 * "2000", "2,000.00", "R2 000,00", "$1,250.50", "20000".
 *
 * The separator question is the whole job. "1.250" is a thousand-two-fifty in
 * half the world and one-and-a-quarter in the other; getting it wrong writes
 * a quote off by a thousand times.
 */
export function parseMoneyToCents(token: string): number | null {
  const cleaned = token
    .replace(new RegExp(CURRENCY, "gi"), "")
    .replace(/\s/g, "")
    .trim();
  if (!cleaned || !/\d/.test(cleaned)) return null;
  if (!/^[\d.,]+$/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const lastSep = Math.max(lastDot, lastComma);

  let whole = cleaned;
  let fraction = "";

  if (lastSep !== -1) {
    const after = cleaned.slice(lastSep + 1);
    // Exactly one or two digits after the final separator means it's a
    // decimal point. Three means it was a thousands grouping ("R2,000").
    if (/^\d{1,2}$/.test(after)) {
      whole = cleaned.slice(0, lastSep);
      fraction = after.padEnd(2, "0");
    }
  }

  const wholeDigits = whole.replace(/[.,]/g, "");
  if (!wholeDigits) return null;

  const cents = Number(wholeDigits) * 100 + Number(fraction || 0);
  return Number.isFinite(cents) ? Math.round(cents) : null;
}

/**
 * A money-shaped run of characters.
 *
 * The alternation order is load-bearing. Grouped thousands must be tried
 * first and must require a real group — with the plain-digits branch first,
 * "20000" matches as "200" and the quote comes out a hundredfold wrong.
 * Built fresh per call so no lastIndex can leak between parses.
 */
function moneyTokenPattern(): RegExp {
  return new RegExp(
    String.raw`(?:${CURRENCY}\s*)?\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,2})?` +
      "|" +
      String.raw`(?:${CURRENCY}\s*)?\d+(?:[.,]\d{1,2})?`,
    "gi"
  );
}

// -------------------------------------------------------------------- lines

const QTY_LEADING = /^\s*(\d+(?:[.,]\d+)?)\s*(?:x|×|\*)\s*/i;
const QTY_TRAILING = /\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)\s*$/i;
const BULLET = /^\s*(?:[-–—*•]|\d+[.)])\s+/;
const EACH = /\b(?:each|ea|per\s+unit|pp|a\s+piece)\b/i;
const TOTAL_MARKER = /\b(?:total|in\s+total|for\s+all|altogether)\b/i;

/**
 * Reads one line into a quantity, a description and a unit price.
 *
 * Returns null for anything that isn't an item line — a heading, a phone
 * number, a blank. Being willing to say "this isn't a line" is what keeps the
 * customer block at the top out of the quote.
 */
export function parseLine(raw: string): ParsedLine | null {
  const original = raw.trim();
  if (!original) return null;

  let text = original.replace(BULLET, "");

  // An email or a bare phone number is contact detail, never an item.
  if (/@/.test(text) && /\S+@\S+\.\S+/.test(text)) return null;
  if (/^[+(]?[\d\s().-]{9,}$/.test(text)) return null;

  let quantity = 1;
  const leading = text.match(QTY_LEADING);
  if (leading) {
    quantity = Number(leading[1].replace(",", "."));
    text = text.slice(leading[0].length);
  }

  // Pull the price off the end before looking for a trailing quantity, so
  // "iPhone 16 x 2 @ 2000" doesn't read 2000 as the quantity.
  const priceInfo = extractTrailingPrice(text);
  if (!priceInfo) return null;
  // Drop the separator the price hung off ("@", "-", ":") so a trailing
  // quantity sits at the end of the string where the next pattern expects it.
  text = priceInfo.rest.replace(/[\s@:,\-–—=]+$/, "");

  if (!leading) {
    const trailing = text.match(QTY_TRAILING);
    if (trailing) {
      quantity = Number(trailing[1].replace(",", "."));
      text = text.slice(0, trailing.index);
    }
  }

  const description = text
    .replace(/[\s@:,\-–—=]+$/, "")
    .replace(/^[\s@:,\-–—=]+/, "")
    .trim();

  if (!description) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;

  // "2 x panels @ 3000" means 3000 apiece — the near-universal reading, and
  // the one every invoicing tool uses. An explicit "total" flips it.
  const isTotal = TOTAL_MARKER.test(original) && !EACH.test(original);
  const unitPriceCents = isTotal
    ? Math.round(priceInfo.cents / quantity)
    : priceInfo.cents;

  return { description, quantity, unitPriceCents, raw: original };
}

function extractTrailingPrice(text: string): { cents: number; rest: string } | null {
  const matches = [...text.matchAll(moneyTokenPattern())];
  if (matches.length === 0) return null;

  const last = matches[matches.length - 1];
  const token = last[0];
  const start = last.index ?? 0;

  const cents = parseMoneyToCents(token);
  if (cents === null) return null;

  // Everything after the number must be noise ("each", "excl vat", a full
  // stop) — otherwise the number is part of the product name ("iPhone 16")
  // rather than its price.
  const after = text.slice(start + token.length).trim();
  if (after && !/^(?:each|ea|per\s+unit|pp|a\s+piece|excl\.?\s*vat|incl\.?\s*vat|total|[.)\]]+)$/i.test(after)) {
    return null;
  }

  return { cents, rest: text.slice(0, start) };
}

// ----------------------------------------------------------------- the whole

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const COMPANY_HINT = /\b(?:\(?pty\)?|ltd|limited|inc\.?|cc|llc|bv|gmbh|holdings|group|enterprises|trading)\b/i;

/**
 * Splits pasted text into who it's for and what's on it.
 *
 * The customer block is whatever sits above the first line that reads as an
 * item — which is how people actually write these, and means no "customer:"
 * label is required.
 */
export function parseQuoteText(text: string): ParsedQuote {
  const rawLines = text.split(/\r?\n/);
  const warnings: string[] = [];

  const lines: ParsedLine[] = [];
  const headerLines: string[] = [];
  let seenFirstItem = false;

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // A "for:" / "customer:" style label is contact detail wherever it sits.
    const labelled = trimmed.match(/^(?:for|customer|client|to|bill\s*to)\s*[:\-]\s*(.+)$/i);
    if (labelled && !seenFirstItem) {
      headerLines.push(labelled[1].trim());
      continue;
    }

    const parsed = parseLine(trimmed);
    if (parsed) {
      lines.push(parsed);
      seenFirstItem = true;
      continue;
    }

    if (!seenFirstItem) {
      headerLines.push(trimmed);
    } else if (!/^(?:thanks|thank you|regards|kind regards|total\b.*)$/i.test(trimmed)) {
      // After the list has started, anything unreadable is probably an item
      // the parser couldn't price — worth saying so rather than dropping.
      warnings.push(`Couldn't read a price on "${trimmed}" — left it off.`);
    }
  }

  return { customer: parseCustomerBlock(headerLines), lines, warnings };
}

export function parseCustomerBlock(headerLines: string[]): ParsedCustomer {
  const customer: ParsedCustomer = {};
  const leftovers: string[] = [];

  for (const line of headerLines) {
    const email = line.match(EMAIL);
    if (email && !customer.email) {
      customer.email = email[0];
      const rest = line.replace(email[0], "").replace(/[<>(),;]/g, "").trim();
      if (rest) leftovers.push(rest);
      continue;
    }

    const phone = line.match(PHONE);
    // A phone line is one that is mostly the number, not a sentence with a
    // year in it.
    if (phone && !customer.phone && phone[0].replace(/\D/g, "").length >= 9) {
      const rest = line.replace(phone[0], "").replace(/^(?:tel|phone|cell|mobile)\s*[:\-]?/i, "").trim();
      if (rest.length <= 3 || /^(?:tel|phone|cell|mobile)$/i.test(rest)) {
        customer.phone = phone[0].trim();
        continue;
      }
    }

    leftovers.push(line);
  }

  for (const line of leftovers) {
    if (COMPANY_HINT.test(line) && !customer.companyName) {
      customer.companyName = line;
    } else if (!customer.name) {
      customer.name = line;
    }
  }

  // A company with no contact person still needs a name on the document.
  if (!customer.name && customer.companyName) customer.name = customer.companyName;

  return customer;
}

// ------------------------------------------------------------- making it real

export interface ComposeResult {
  quoteId: string;
  customerId: string;
  customerName: string;
  /** True when this paste brought a customer the workspace didn't have. */
  createdCustomer: boolean;
  /** Products added to the catalog because the paste named something new. */
  createdProducts: string[];
  lines: { description: string; quantity: number; unitPriceCents: number }[];
  totalCents: number;
  warnings: string[];
}

/**
 * Turns pasted text into a real DRAFT quote.
 *
 * Draft, always: this composes, it never sends. Sending stays behind the same
 * approval the autonomy gate applies to everything that leaves the building.
 */
export async function composeQuoteFromText(params: {
  tenantId: string;
  text: string;
  /** Use an existing customer instead of whatever the text names. */
  customerId?: string;
  salesPersonMembershipId?: string;
  subject?: string;
}): Promise<ComposeResult> {
  const { tenantId, text, customerId, salesPersonMembershipId, subject } = params;

  const parsed = parseQuoteText(text);
  if (parsed.lines.length === 0) {
    throw new Error(
      "I couldn't find any priced items in that. Write one per line, like: 2 x iPhone 16 @ 20000"
    );
  }

  const warnings = [...parsed.warnings];

  const { party, created } = customerId
    ? { party: await requireOwnedParty(tenantId, customerId), created: false }
    : await resolveCustomer(tenantId, parsed.customer, warnings);

  const createdProducts: string[] = [];
  const quoteLines: QuoteLineInput[] = [];

  for (const line of parsed.lines) {
    const item = await resolveItem(tenantId, line, createdProducts);
    quoteLines.push({
      itemId: item.id,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
    });
  }

  const quote = await createQuote({
    tenantId,
    partyId: party.id,
    lines: quoteLines,
    salesPersonMembershipId,
    subject,
  });

  return {
    quoteId: quote.id,
    customerId: party.id,
    customerName: party.name,
    createdCustomer: created,
    createdProducts,
    lines: parsed.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
    })),
    totalCents: quote.amountCents,
    warnings,
  };
}

async function requireOwnedParty(tenantId: string, partyId: string) {
  const party = await prisma.party.findFirst({ where: { id: partyId, tenantId } });
  if (!party) throw new Error("Customer not found.");
  return party;
}

/**
 * Finds the customer this is for, or adds them.
 *
 * Email first, then phone, then name: the first two identify a person, a name
 * only suggests one. Matching two different Dlaminis onto one record is worse
 * than creating a duplicate somebody can merge.
 */
async function resolveCustomer(
  tenantId: string,
  details: ParsedCustomer,
  warnings: string[]
): Promise<{ party: { id: string; name: string }; created: boolean }> {
  if (!details.name && !details.email && !details.phone) {
    throw new Error(
      "I couldn't tell who this is for. Put their name (and email or number) on the first lines."
    );
  }
  const result = await findOrCreateCustomer({ tenantId, ...details });
  if (result.created) {
    warnings.push(`${result.party.name} wasn't in your customers yet — I added them.`);
  }
  return result;
}

/**
 * Finds the customer these details describe, or adds them.
 *
 * Email first, then phone, then name: the first two identify a person, a name
 * only suggests one. Matching two different Dlaminis onto one record is worse
 * than creating a duplicate somebody can merge.
 *
 * Shared by the paste box, the agent, and the new-quote form — which used to
 * call createParty unconditionally, so quoting the same person twice left the
 * workspace with two of them and split their history down the middle.
 */
export async function findOrCreateCustomer(params: {
  tenantId: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  role?: PartyRole;
}): Promise<{ party: { id: string; name: string }; created: boolean }> {
  const { tenantId, role = PartyRole.CUSTOMER } = params;
  const details: ParsedCustomer = {
    name: params.name?.trim() || undefined,
    email: params.email?.trim() || undefined,
    phone: params.phone?.trim() || undefined,
    companyName: params.companyName?.trim() || undefined,
  };

  if (details.email) {
    const byEmail = await prisma.party.findFirst({
      where: { tenantId, email: { equals: details.email, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (byEmail) return { party: byEmail, created: false };
  }

  if (details.phone) {
    const digits = details.phone.replace(/\D/g, "");
    // Match on the last nine digits so "+27 82 555 1234" finds "082 555 1234".
    const tail = digits.slice(-9);
    if (tail.length === 9) {
      const candidates = await prisma.party.findMany({
        where: { tenantId, phone: { not: null } },
        select: { id: true, name: true, phone: true },
        take: 500,
      });
      const hit = candidates.find((c) => (c.phone ?? "").replace(/\D/g, "").endsWith(tail));
      if (hit) return { party: { id: hit.id, name: hit.name }, created: false };
    }
  }

  if (details.name) {
    const byName = await prisma.party.findFirst({
      where: { tenantId, role, name: { equals: details.name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (byName) return { party: byName, created: false };
  }

  const name = details.name ?? details.companyName ?? details.email ?? details.phone;
  if (!name) {
    throw new Error(
      "I couldn't tell who this is for. Put their name (and email or number) on the first lines."
    );
  }

  const { createParty } = await import("@/lib/core/parties");
  const party = await createParty({
    tenantId,
    role,
    name,
    email: details.email,
    phone: details.phone,
    companyName: details.companyName,
  });
  return { party: { id: party.id, name: party.name }, created: true };
}

/**
 * Matches a line to something in the catalog, or adds it.
 *
 * Exact name first, then a unique containing match. A containing match that
 * hits several products is not a match — quietly picking the first "cable"
 * out of nine is how the wrong thing ends up on a quote.
 */
async function resolveItem(
  tenantId: string,
  line: ParsedLine,
  createdProducts: string[]
): Promise<{ id: string }> {
  const exact = await prisma.item.findFirst({
    where: { tenantId, isActive: true, name: { equals: line.description, mode: "insensitive" } },
    select: { id: true },
  });
  if (exact) return exact;

  const similar = await prisma.item.findMany({
    where: { tenantId, isActive: true, name: { contains: line.description, mode: "insensitive" } },
    select: { id: true },
    take: 2,
  });
  if (similar.length === 1) return similar[0];

  const { createProduct } = await import("@/lib/core/catalog");
  const item = await createProduct({
    tenantId,
    name: line.description,
    unitPriceCents: line.unitPriceCents,
  });
  createdProducts.push(line.description);
  return { id: item.id };
}
