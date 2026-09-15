// Find — naming a thing, rather than asking about it.
//
// The one input on every screen has to tell three intentions apart: a
// question ("who owes us the most?"), an action ("chase Acme"), and a name
// ("Acme", "INV-0042", "the Hilux"). This module answers the third: given
// what someone typed, the records it plausibly names, and the pages whose
// names it matches. The bar shows them above the conversation; Enter on one
// goes there, and anything else goes to the agent.

import { prisma } from "@/lib/db";

export interface FindResult {
  kind: "customer" | "supplier" | "quote" | "invoice" | "product" | "asset" | "trip" | "page";
  label: string;
  hint: string;
  href: string;
}

const PAGES: Array<{ path: string; label: string; words: string }> = [
  { path: "brief", label: "The Brief", words: "brief home today officers findings" },
  { path: "quotes", label: "Quotes", words: "quotes proposals estimates" },
  { path: "invoices", label: "Invoices", words: "invoices billing" },
  { path: "customers", label: "Customers", words: "customers clients" },
  { path: "expenses", label: "Expenses", words: "expenses slips receipts spend capture" },
  { path: "costs", label: "Costs", words: "costs cost per km margin per job lane" },
  { path: "savings", label: "Savings", words: "savings consolidation subscriptions suppliers" },
  { path: "value", label: "Value", words: "value ledger worth saved roi" },
  { path: "trips", label: "Trips", words: "trips runs loads deliveries driving" },
  { path: "fleet", label: "Fleet", words: "fleet vehicles fuel service tyres detention incidents" },
  { path: "books", label: "The books", words: "books accounts ledger profit loss balance sheet" },
  { path: "books/month-end", label: "Month-end", words: "month end close cash flow tax vat depreciation" },
  { path: "banking", label: "Bank & reconciliation", words: "bank reconciliation statement" },
  { path: "compliance", label: "Compliance", words: "compliance legal renewals licences cipc tax clearance" },
  { path: "cash-forecast", label: "Cash forecast", words: "cash forecast runway" },
  { path: "products", label: "Products", words: "products catalogue items services" },
  { path: "inventory", label: "Inventory", words: "inventory stock reorder" },
  { path: "job-cards", label: "Job cards", words: "jobs job cards work" },
  { path: "staff", label: "Staff & roles", words: "staff team people roles" },
  { path: "assets", label: "Assets", words: "assets equipment laptops tools vehicles register" },
  { path: "settings/officers", label: "Officers", words: "officers autonomy ceo cfo coo legal sales efficiency turnaround" },
  { path: "settings", label: "Settings", words: "settings preferences" },
];

/** A question or an instruction, not a name — so nothing is preselected. */
export function looksLikeAsking(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.includes("?")) return true;
  return /^(who|what|when|where|why|how|which|is|are|can|should|do|does|did|chase|draft|send|create|add|make|record|log|remind|show|list|give|tell|find me|help|book|plan|start|end|bill|pay|turn)\b/.test(t);
}

export async function find(tenantId: string, raw: string, limit = 8): Promise<FindResult[]> {
  const q = raw.trim();
  if (q.length < 2) return [];
  const d = `/dashboard/${tenantId}`;
  const like = { contains: q, mode: "insensitive" as const };
  const lower = q.toLowerCase();

  const [parties, docs, items, assets, trips] = await Promise.all([
    prisma.party.findMany({
      where: { tenantId, OR: [{ name: like }, { companyName: like }, { email: like }, { phone: { contains: q.replace(/\s+/g, "") } }] },
      select: { id: true, name: true, role: true, city: true },
      take: 5,
    }),
    prisma.transaction.findMany({
      where: {
        tenantId,
        type: { in: ["QUOTE", "INVOICE"] },
        OR: [{ subject: like }, { poNumber: like }, { id: { startsWith: q } }, { party: { name: like } }],
      },
      select: { id: true, type: true, status: true, amountCents: true, subject: true, party: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.item.findMany({ where: { tenantId, OR: [{ name: like }, { sku: like }] }, select: { id: true, name: true, sku: true }, take: 4 }),
    prisma.asset.findMany({ where: { tenantId, OR: [{ name: like }, { registration: like }, { serial: like }] }, select: { id: true, name: true, registration: true }, take: 4 }),
    prisma.trip.findMany({
      where: { tenantId, OR: [{ destinationText: like }, { originText: like }] },
      select: { id: true, originText: true, destinationText: true, startedAt: true },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
  ]);

  const out: FindResult[] = [];
  for (const p of parties) {
    out.push({
      kind: p.role === "SUPPLIER" ? "supplier" : "customer",
      label: p.name,
      hint: [p.role.toLowerCase(), p.city].filter(Boolean).join(" · "),
      href: `${d}/customers/${p.id}`,
    });
  }
  for (const t of docs) {
    out.push({
      kind: t.type === "QUOTE" ? "quote" : "invoice",
      label: `${t.type === "QUOTE" ? "Quote" : "Invoice"} · ${t.party.name}${t.subject ? ` · ${t.subject}` : ""}`,
      hint: `${t.status.toLowerCase().replace("_", " ")} · ${(t.amountCents / 100).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`,
      href: `${d}/${t.type === "QUOTE" ? "quotes" : "invoices"}/${t.id}`,
    });
  }
  for (const i of items) out.push({ kind: "product", label: i.name, hint: i.sku ? `product · ${i.sku}` : "product", href: `${d}/products?q=${encodeURIComponent(i.name)}` });
  for (const a of assets) out.push({ kind: "asset", label: a.name, hint: a.registration ? `asset · ${a.registration}` : "asset", href: `${d}/assets/${a.id}` });
  for (const t of trips) out.push({ kind: "trip", label: `${t.originText ?? "?"} → ${t.destinationText ?? "?"}`, hint: `trip · ${t.startedAt ? t.startedAt.toISOString().slice(0, 10) : "planned"}`, href: `${d}/trips` });
  for (const p of PAGES) {
    if (p.label.toLowerCase().includes(lower) || p.words.split(" ").some((w) => w.startsWith(lower))) {
      out.push({ kind: "page", label: p.label, hint: "page", href: `${d}/${p.path}` });
    }
  }
  return out.slice(0, limit);
}
