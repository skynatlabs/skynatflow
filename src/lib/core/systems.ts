// The engine under what they already run.
//
// Nobody rips out the till on a Tuesday because a new system asked them to.
// Every product in this category loses deals to "we already use Sage" and
// answers it by demanding a migration first — which is asking a business to
// take the risk before it has seen the benefit.
//
// So the order is reversed. Tell us what you run. We take your history out of
// it, and we keep taking the daily numbers. You carry on using it as long as
// you like. And the case for moving the rest is made by the difference
// between what you can see here and what you can see there — measured from
// your own data, not asserted in a brochure.
//
// Two honesty rules hold this together, because an integrations page that
// lies is worse than no integrations page:
//   - Every system says exactly how it connects today. "Live" means a
//     connector exists in this codebase. Everything else says so.
//   - The export instructions are the real menu path, because "export your
//     data from your POS" is not instructions.

import { prisma } from "@/lib/db";

export type SystemCategory = "till" | "accounting" | "store" | "spreadsheet" | "documents" | "payroll" | "other";

/** How flow talks to it today. Nothing here may overstate what exists. */
export type LinkKind =
  /** A connector in this codebase, running now. */
  | "live"
  /** Bring the data across by exporting a file from it. Always available. */
  | "import"
  /** Their side can push to flow's own API, which is documented and keyed. */
  | "api";

export interface SystemDef {
  key: string;
  label: string;
  category: SystemCategory;
  /** What it does, in the words of somebody who uses it. */
  what: string;
  links: LinkKind[];
  /** The actual menu path to the export. Not "export your data". */
  exportPath?: string;
  /** What comes across when you do. */
  brings?: string;
}

export const SYSTEM_CATALOGUE: SystemDef[] = [
  // ------------------------------------------------------------------ tills
  {
    key: "yoco",
    label: "Yoco",
    category: "till",
    what: "Card machine and point of sale.",
    links: ["live", "import"],
    exportPath: "Yoco portal → Sales → Export → CSV",
    brings: "Every sale, its date, its total and how it was paid.",
  },
  {
    key: "sumup",
    label: "SumUp",
    category: "till",
    what: "Card reader and till app.",
    links: ["import"],
    exportPath: "SumUp dashboard → Sales → Export → CSV",
    brings: "Sales and payouts, so the bank line matches the takings.",
  },
  {
    key: "loyverse",
    label: "Loyverse",
    category: "till",
    what: "Free till app, common in small shops.",
    links: ["import"],
    exportPath: "Back office → Items → Export, and Reports → Sales by item → Export",
    brings: "The whole item list with prices and stock, plus what has sold.",
  },
  {
    key: "square",
    label: "Square",
    category: "till",
    what: "Card reader, till and online store.",
    links: ["import"],
    exportPath: "Dashboard → Items → Actions → Export library, and Transactions → Export",
    brings: "Items, prices, stock counts, and every transaction.",
  },
  {
    key: "lightspeed",
    label: "Lightspeed / Vend",
    category: "till",
    what: "Retail point of sale for bigger shops.",
    links: ["import"],
    exportPath: "Catalog → Products → Export, and Reporting → Sales → Export",
    brings: "The catalogue with supplier costs, and sales history.",
  },

  // ------------------------------------------------------------- accounting
  {
    key: "sage",
    label: "Sage Business Cloud / Pastel",
    category: "accounting",
    what: "The books, VAT and the annual return.",
    links: ["import"],
    exportPath: "Company → Reports → Customer listing → Export to CSV; same for Suppliers and Inventory",
    brings: "Customers, suppliers, the item list, and outstanding balances.",
  },
  {
    key: "xero",
    label: "Xero",
    category: "accounting",
    what: "Online accounting.",
    links: ["import"],
    exportPath: "Contacts → Export, Products and services → Export, Invoices → Export",
    brings: "Contacts, items and invoice history with what is still owed.",
  },
  {
    key: "quickbooks",
    label: "QuickBooks",
    category: "accounting",
    what: "Online accounting.",
    links: ["import"],
    exportPath: "Sales → Customers → Export to Excel; Sales → Products and services → Export",
    brings: "Customers, products, and open invoices.",
  },
  {
    key: "zoho-books",
    label: "Zoho Books",
    category: "accounting",
    what: "Online accounting and invoicing.",
    links: ["import"],
    exportPath: "Settings → Data backup, or each list's ⋯ → Export",
    brings: "Estimates and invoices with their own numbers, so a re-import fills gaps rather than duplicating.",
  },

  // ------------------------------------------------------------------ store
  {
    key: "woocommerce",
    label: "WooCommerce",
    category: "store",
    what: "An online shop on WordPress.",
    links: ["live", "import"],
    exportPath: "WooCommerce → Products → Export, and Orders → Export",
    brings: "Products, stock and orders — and once connected, orders as they happen.",
  },
  {
    key: "shopify",
    label: "Shopify",
    category: "store",
    what: "Hosted online shop.",
    links: ["import"],
    exportPath: "Products → Export → CSV, and Orders → Export",
    brings: "The product list with variants and stock, and order history.",
  },
  {
    key: "takealot",
    label: "Takealot Seller Portal",
    category: "store",
    what: "Marketplace listings and sales.",
    links: ["import"],
    exportPath: "Seller portal → Sales → Download report",
    brings: "What sold, when, and at what fee.",
  },

  // ------------------------------------------------------ spreadsheets, docs
  {
    key: "excel",
    label: "Excel or Google Sheets",
    category: "spreadsheet",
    what: "Where the stock list, the price list and the debtors book actually live.",
    links: ["import"],
    exportPath: "Save as .xlsx or .csv. Google Sheets: File → Download → Microsoft Excel",
    brings: "Whatever is in it — products, customers, prices, stock. Columns are matched for you.",
  },
  {
    key: "word",
    label: "Word, WPS or Google Docs",
    category: "documents",
    what: "Where quotes and contracts get written.",
    links: ["import"],
    exportPath: "Nothing to export — every quote, invoice, contract and delivery note here downloads as .docx.",
    brings: "Works the other way: the documents made here open in Word, WPS, LibreOffice and Google Docs.",
  },

  // ---------------------------------------------------------------- payroll
  {
    key: "simplepay",
    label: "SimplePay",
    category: "payroll",
    what: "Payslips, PAYE and UIF.",
    links: ["import"],
    exportPath: "Reports → Employee information → Export",
    brings: "The staff list, so time and jobs can be costed against real people.",
  },

  {
    key: "other",
    label: "Something else",
    category: "other",
    what: "Anything not on this list.",
    links: ["import", "api"],
    exportPath: "Whatever it exports — CSV and Excel both work.",
    brings: "Tell us what it is and we will read what it gives you.",
  },
];

export const SYSTEM_BY_KEY: Record<string, SystemDef> = Object.fromEntries(SYSTEM_CATALOGUE.map((s) => [s.key, s]));

export const CATEGORY_LABEL: Record<SystemCategory, string> = {
  till: "Till and card machine",
  accounting: "Accounting",
  store: "Online store",
  spreadsheet: "Spreadsheets",
  documents: "Documents",
  payroll: "Payroll",
  other: "Something else",
};

export async function listSystems(tenantId: string) {
  const rows = await prisma.connectedSystem.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  return rows.map((row) => ({ ...row, def: SYSTEM_BY_KEY[row.systemKey] ?? SYSTEM_BY_KEY.other }));
}

export async function addSystem(params: {
  tenantId: string;
  systemKey: string;
  label?: string | null;
  isSystemOfRecord?: boolean;
  notes?: string | null;
}) {
  const def = SYSTEM_BY_KEY[params.systemKey];
  if (!def) throw new Error("That is not one of the systems we know about.");
  if (params.systemKey === "other" && !params.label?.trim()) throw new Error("What is it called?");

  return prisma.connectedSystem.upsert({
    where: { tenantId_systemKey: { tenantId: params.tenantId, systemKey: params.systemKey } },
    create: {
      tenantId: params.tenantId,
      systemKey: params.systemKey,
      label: params.label?.trim() || null,
      category: def.category,
      isSystemOfRecord: params.isSystemOfRecord ?? true,
      notes: params.notes?.trim() || null,
    },
    update: {
      label: params.label?.trim() || undefined,
      isSystemOfRecord: params.isSystemOfRecord ?? undefined,
      notes: params.notes?.trim() || undefined,
      retiredAt: null,
    },
  });
}

/** Records came across from it. Called by whatever actually did the import. */
export async function recordImport(tenantId: string, systemKey: string, records: number) {
  const existing = await prisma.connectedSystem.findUnique({
    where: { tenantId_systemKey: { tenantId, systemKey } },
    select: { id: true },
  });
  if (!existing) return null;
  return prisma.connectedSystem.update({
    where: { id: existing.id },
    data: { lastImportAt: new Date(), importedRecords: { increment: Math.max(0, records) } },
  });
}

/** They have moved off it. The row stays — when somebody switched matters. */
export async function retireSystem(tenantId: string, systemKey: string) {
  const existing = await prisma.connectedSystem.findUnique({
    where: { tenantId_systemKey: { tenantId, systemKey } },
    select: { id: true },
  });
  if (!existing) throw new Error("That system is not on this workspace.");
  return prisma.connectedSystem.update({
    where: { id: existing.id },
    data: { retiredAt: new Date(), isSystemOfRecord: false },
  });
}

export async function removeSystem(tenantId: string, systemKey: string) {
  const { count } = await prisma.connectedSystem.deleteMany({ where: { tenantId, systemKey } });
  if (count === 0) throw new Error("That system is not on this workspace.");
  return { removed: count };
}

export interface SwitchoverGap {
  key: string;
  /** What is not working, said as a consequence rather than a missing field. */
  missing: string;
  /** What it would take. */
  needs: string;
  /** Which of their other systems is holding it, where that is knowable. */
  heldBy?: string;
}

export interface Switchover {
  /** 0-100. What share of the business is actually running through here. */
  percent: number;
  onFlow: string[];
  gaps: SwitchoverGap[];
  stillElsewhere: Array<{ key: string; label: string; category: string; since: Date }>;
  movedOff: Array<{ label: string; on: Date }>;
}

/**
 * How much of the business actually runs here yet — measured, not claimed.
 *
 * This is the whole "gradually ask them to switch" mechanism, and it only
 * works if it is honest. Each line is something this workspace genuinely
 * cannot do while the data lives somewhere else, said as the consequence the
 * owner feels rather than as a missing table. A page that told them they were
 * 40% switched and listed no reason would be marketing; this lists reasons
 * and lets the percentage follow from them.
 */
export async function switchover(tenantId: string): Promise<Switchover> {
  const [systems, counts] = await Promise.all([
    prisma.connectedSystem.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
    (async () => {
      const [invoices, payments, items, withCost, parties, expenses, tills, staff, documents] = await Promise.all([
        prisma.transaction.count({ where: { tenantId, type: "INVOICE", status: { not: "DRAFT" } } }),
        prisma.transaction.count({ where: { tenantId, type: "PAYMENT" } }),
        prisma.item.count({ where: { tenantId } }),
        prisma.item.count({ where: { tenantId, costCents: { gt: 0 } } }),
        prisma.party.count({ where: { tenantId, role: "CUSTOMER" } }),
        prisma.expense.count({ where: { tenantId } }),
        prisma.tillSession.count({ where: { tenantId } }),
        prisma.membership.count({ where: { tenantId } }),
        prisma.deliveryNote.count({ where: { tenantId } }),
      ]);
      return { invoices, payments, items, withCost, parties, expenses, tills, staff, documents };
    })(),
  ]);

  const live = systems.filter((s) => !s.retiredAt);
  const holder = (category: string) => live.find((s) => s.category === category && s.isSystemOfRecord);
  const nameOf = (row: (typeof live)[number] | undefined) =>
    row ? row.label ?? SYSTEM_BY_KEY[row.systemKey]?.label ?? row.systemKey : undefined;

  const onFlow: string[] = [];
  const gaps: SwitchoverGap[] = [];

  const check = (
    ok: boolean,
    done: string,
    gap: { key: string; missing: string; needs: string; category?: string }
  ) => {
    if (ok) onFlow.push(done);
    else gaps.push({ key: gap.key, missing: gap.missing, needs: gap.needs, heldBy: gap.category ? nameOf(holder(gap.category)) : undefined });
  };

  check(counts.parties > 0, "Your customers are here.", {
    key: "customers",
    missing: "Nothing can chase a debtor or write a statement, because there is nobody to chase.",
    needs: "Import your customer list.",
    category: "accounting",
  });

  check(counts.items > 0, "Your price list is here.", {
    key: "items",
    missing: "A quote has to be typed from scratch every time, and stock is not counted at all.",
    needs: "Import your item list.",
    category: "till",
  });

  check(counts.invoices > 0, "You are invoicing from here.", {
    key: "invoices",
    missing: "The cash forecast has nothing to forecast, and nothing knows what is owed to you.",
    needs: "Raise invoices here, or import the open ones.",
    category: "accounting",
  });

  check(counts.payments > 0, "Payments are recorded against the invoices.", {
    key: "payments",
    missing: "Every invoice reads as unpaid, so the overdue list is wrong and the chasing is wrong with it.",
    needs: "Record payments here, or bring the receipts across.",
    category: "accounting",
  });

  check(counts.withCost > 0, "Your costs are on your items, so margin is real.", {
    key: "costs",
    missing: "Margin cannot be worked out at all — every report shows revenue and calls it profit.",
    needs: "Put cost prices on your items, or import them from your supplier list.",
    category: "till",
  });

  check(counts.expenses > 0, "Your costs and slips are captured.", {
    key: "expenses",
    missing: "The books only see money coming in, so the profit figure is not a profit figure.",
    needs: "Photograph your slips, or import the expense export.",
    category: "accounting",
  });

  check(counts.tills > 0 || counts.invoices > 5, "Daily takings reach the books.", {
    key: "takings",
    missing: "A day's till takings never reach the cash forecast, so it plans on the invoices alone.",
    needs: "Cash up here at the end of the day, or import the daily sales export.",
    category: "till",
  });

  check(counts.staff > 1, "Your team is on here.", {
    key: "staff",
    missing: "Work cannot be assigned, and nothing can be costed against the person who did it.",
    needs: "Invite the people who work with you.",
    category: "payroll",
  });

  check(counts.documents > 0 || counts.invoices > 0, "Documents go out from here.", {
    key: "documents",
    missing: "Documents are still made by hand somewhere else, so nothing here knows what was promised.",
    needs: "Send a quote, an invoice or a delivery note from here.",
    category: "documents",
  });

  const total = onFlow.length + gaps.length;
  return {
    percent: total === 0 ? 0 : Math.round((onFlow.length / total) * 100),
    onFlow,
    gaps,
    stillElsewhere: live
      .filter((s) => s.isSystemOfRecord)
      .map((s) => ({
        key: s.systemKey,
        label: s.label ?? SYSTEM_BY_KEY[s.systemKey]?.label ?? s.systemKey,
        category: s.category,
        since: s.createdAt,
      })),
    movedOff: systems
      .filter((s) => s.retiredAt)
      .map((s) => ({ label: s.label ?? SYSTEM_BY_KEY[s.systemKey]?.label ?? s.systemKey, on: s.retiredAt! })),
  };
}
