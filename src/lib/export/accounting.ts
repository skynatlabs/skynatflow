// Handing the books to the bookkeeper.
//
// The single most common reason a small business keeps paying for a second
// subscription is that its accountant will not work from anything else. That
// is not a technical objection — the accountant wants a file their own
// software imports without an argument, and every one of them accepts a CSV
// in a shape they already know.
//
// So: the same ledger, written in each package's own import format. This is
// deliberately not a two-way sync. A two-way sync between two systems that
// both think they own the chart of accounts produces conflicts nobody can
// adjudicate, and the losing side is always the small business. A file the
// bookkeeper imports is a boundary both sides understand.
//
// Live OAuth sync to each package is the next step and is honestly not built:
// it needs a developer account and an app review per vendor.

import { prisma } from "@/lib/db";
import { toCsv } from "./csv";

/**
 * Rows here are written as objects because each package names its columns
 * differently and keeping the name beside the value is the only way to read
 * the mapping. The header order is taken from the first row, which is also
 * the order every one of these packages expects.
 */
function objectsToCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return toCsv(
    headers,
    rows.map((row) => headers.map((h) => row[h] ?? "")),
  );
}

export type Package = "xero" | "quickbooks" | "sage" | "zoho" | "generic";

export interface PackageDef {
  key: Package;
  label: string;
  /** What to do with the file, in the words of the person doing it. */
  how: string;
  /** What is not built, said plainly. */
  liveSync: string;
}

export const PACKAGES: PackageDef[] = [
  {
    key: "xero",
    label: "Xero",
    how: "Business → Bills or Sales → Import, then map the columns it offers. Xero remembers the mapping for next time.",
    liveSync: "A live two-way connection needs a Xero app and its certification review. Not built.",
  },
  {
    key: "quickbooks",
    label: "QuickBooks Online",
    how: "Settings → Import Data → Invoices, then match the fields.",
    liveSync: "A live connection needs an Intuit developer app and its security review. Not built.",
  },
  {
    key: "sage",
    label: "Sage Business Cloud / Pastel",
    how: "Company → Import → Customer transactions. Sage wants its own date format, which is what this file uses.",
    liveSync: "A live connection needs a Sage developer account. Not built.",
  },
  {
    key: "zoho",
    label: "Zoho Books",
    how: "Sales → Invoices → Import Invoices.",
    liveSync: "Not built.",
  },
  {
    key: "generic",
    label: "Anything else, or a spreadsheet",
    how: "Plain columns with full dates and amounts in units rather than cents. Opens in Excel, Sheets and every package that takes a CSV.",
    liveSync: "—",
  },
];

/** Each package's own date convention. Getting this wrong is the usual failure. */
function dateFor(pkg: Package, d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  if (pkg === "sage") {
    const [y, m, day] = iso.split("-");
    return `${day}/${m}/${y}`;
  }
  if (pkg === "quickbooks") {
    const [y, m, day] = iso.split("-");
    return `${m}/${day}/${y}`;
  }
  return iso;
}

/** Cents to the units every accounting package expects. */
function units(cents: number): string {
  return (cents / 100).toFixed(2);
}

export interface ExportResult {
  fileName: string;
  csv: string;
  rows: number;
  /** What was left out and why. Never silent. */
  notes: string[];
}

/**
 * Invoices, in the package's own import shape.
 *
 * One row per line rather than per invoice, because that is what all four
 * packages expect and collapsing them loses the analysis the accountant is
 * importing for. Drafts are left out — an accountant importing a draft is
 * importing something that does not exist.
 */
export async function exportInvoices(params: {
  tenantId: string;
  pkg: Package;
  from: Date;
  to: Date;
}): Promise<ExportResult> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: params.tenantId },
    select: { name: true, currency: true },
  });

  const invoices = await prisma.transaction.findMany({
    where: {
      tenantId: params.tenantId,
      type: "INVOICE",
      status: { notIn: ["DRAFT", "CANCELLED"] },
      createdAt: { gte: params.from, lte: params.to },
    },
    orderBy: { createdAt: "asc" },
    include: {
      party: { select: { name: true, companyName: true, email: true, vatNumber: true } },
      itemLines: { include: { item: { select: { name: true, sku: true, taxRatePercent: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });

  const notes: string[] = [];
  const rows: Array<Record<string, string>> = [];
  let withoutLines = 0;

  for (const invoice of invoices) {
    const number = invoice.externalRef ?? `INV-${invoice.id.slice(-6).toUpperCase()}`;
    const customer = invoice.party.companyName ?? invoice.party.name;
    const date = dateFor(params.pkg, invoice.createdAt);
    const due = invoice.dueAt ? dateFor(params.pkg, invoice.dueAt) : date;

    if (invoice.itemLines.length === 0) {
      // An invoice with no lines still has a total, and dropping it would
      // make the export disagree with the books.
      withoutLines += 1;
      rows.push(rowFor(params.pkg, {
        number,
        customer,
        email: invoice.party.email ?? "",
        date,
        due,
        description: invoice.subject ?? "Services",
        quantity: "1",
        unitAmount: units(invoice.amountCents),
        taxRate: "",
        currency: invoice.currency ?? tenant.currency,
      }));
      continue;
    }

    for (const line of invoice.itemLines) {
      const rate = line.taxRatePercent ?? line.item.taxRatePercent ?? 0;
      const net = line.unitPriceCents * (1 - (line.discountPercent ?? 0) / 100);
      rows.push(rowFor(params.pkg, {
        number,
        customer,
        email: invoice.party.email ?? "",
        date,
        due,
        description: line.description ?? line.item.name,
        quantity: String(line.quantity),
        unitAmount: units(Math.round(net)),
        taxRate: rate > 0 ? String(rate) : "",
        currency: invoice.currency ?? tenant.currency,
      }));
    }
  }

  if (withoutLines > 0) {
    notes.push(`${withoutLines} ${withoutLines === 1 ? "invoice has" : "invoices have"} no line items, so each is exported as a single line at its total.`);
  }
  notes.push("Drafts and cancelled documents are not included — an accountant importing a draft is importing something that does not exist.");
  notes.push(PACKAGES.find((p) => p.key === params.pkg)!.how);

  return {
    fileName: `${tenant.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-invoices-${params.from.toISOString().slice(0, 10)}-${params.pkg}.csv`,
    csv: objectsToCsv(rows),
    rows: rows.length,
    notes,
  };
}

interface Row {
  number: string;
  customer: string;
  email: string;
  date: string;
  due: string;
  description: string;
  quantity: string;
  unitAmount: string;
  taxRate: string;
  currency: string;
}

/** Each package's own column names. This is the whole difficulty of the job. */
function rowFor(pkg: Package, r: Row): Record<string, string> {
  switch (pkg) {
    case "xero":
      return {
        ContactName: r.customer,
        EmailAddress: r.email,
        InvoiceNumber: r.number,
        InvoiceDate: r.date,
        DueDate: r.due,
        Description: r.description,
        Quantity: r.quantity,
        UnitAmount: r.unitAmount,
        TaxType: r.taxRate ? "Tax on Sales" : "Tax Exempt",
        Currency: r.currency,
      };
    case "quickbooks":
      return {
        "*InvoiceNo": r.number,
        "*Customer": r.customer,
        "*InvoiceDate": r.date,
        "*DueDate": r.due,
        ItemDescription: r.description,
        ItemQuantity: r.quantity,
        ItemRate: r.unitAmount,
        ItemTaxCode: r.taxRate ? "TAX" : "NON",
        Currency: r.currency,
      };
    case "sage":
      return {
        "Customer Name": r.customer,
        "Document Number": r.number,
        "Document Date": r.date,
        "Due Date": r.due,
        Description: r.description,
        Quantity: r.quantity,
        "Unit Price": r.unitAmount,
        "Tax Percentage": r.taxRate || "0",
        Currency: r.currency,
      };
    case "zoho":
      return {
        "Invoice Number": r.number,
        "Customer Name": r.customer,
        "Invoice Date": r.date,
        "Due Date": r.due,
        "Item Name": r.description,
        Quantity: r.quantity,
        "Item Price": r.unitAmount,
        "Item Tax %": r.taxRate,
        "Currency Code": r.currency,
      };
    default:
      return {
        Number: r.number,
        Customer: r.customer,
        Email: r.email,
        Date: r.date,
        Due: r.due,
        Description: r.description,
        Quantity: r.quantity,
        UnitPrice: r.unitAmount,
        TaxPercent: r.taxRate,
        Currency: r.currency,
      };
  }
}

/** Costs, for the other half of the books. */
export async function exportCosts(params: { tenantId: string; pkg: Package; from: Date; to: Date }): Promise<ExportResult> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { name: true, currency: true } });
  const costs = await prisma.expense.findMany({
    // A rejected claim is not a cost, and a row already recognised as the
    // same spend arriving twice must never reach the books a second time.
    where: { tenantId: params.tenantId, status: { notIn: ["REJECTED", "DUPLICATE"] }, spentOn: { gte: params.from, lte: params.to } },
    orderBy: { spentOn: "asc" },
    include: { supplier: { select: { name: true, companyName: true } }, account: { select: { code: true, name: true } } },
  });

  const rows = costs.map((cost) => ({
    Date: dateFor(params.pkg, cost.spentOn),
    Supplier: cost.supplier?.companyName ?? cost.supplier?.name ?? cost.supplierName ?? "Unknown",
    Reference: cost.reference ?? "",
    Description: cost.isOwnerDrawing ? `${cost.descriptionText} (owner drawing, not a business cost)` : cost.descriptionText,
    Account: cost.account ? `${cost.account.code} ${cost.account.name}` : cost.category ?? "",
    Amount: units(cost.amountCents - (cost.taxCents ?? 0)),
    Tax: units(cost.taxCents ?? 0),
    Total: units(cost.amountCents),
    Currency: tenant.currency,
  }));

  const untaxed = costs.filter((c) => !c.taxCents).length;
  const uncoded = costs.filter((c) => !c.accountId && !c.category).length;
  const notes = [PACKAGES.find((p) => p.key === params.pkg)!.how];
  if (untaxed > 0) notes.push(`${untaxed} ${untaxed === 1 ? "cost has" : "costs have"} no tax recorded, so the tax column is zero on ${untaxed === 1 ? "it" : "them"}.`);
  if (uncoded > 0) notes.push(`${uncoded} ${uncoded === 1 ? "cost is" : "costs are"} not coded to an account — your bookkeeper will have to place ${uncoded === 1 ? "it" : "them"}.`);
  if (costs.some((c) => c.isOwnerDrawing)) notes.push("Owner drawings are included and marked in the description. They are not business costs.");

  return {
    fileName: `${tenant.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-costs-${params.from.toISOString().slice(0, 10)}-${params.pkg}.csv`,
    csv: objectsToCsv(rows),
    rows: rows.length,
    notes,
  };
}

/**
 * The trial balance — the one thing an accountant asks for by name.
 *
 * Every account with its debits and credits for the period. If the two
 * columns do not agree the export says so rather than quietly presenting an
 * unbalanced set of books, because an out-of-balance trial balance is a real
 * finding and hiding it wastes somebody's afternoon.
 */
export async function exportTrialBalance(params: { tenantId: string; from: Date; to: Date }): Promise<ExportResult> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { name: true, currency: true } });

  const lines = await prisma.journalLine.findMany({
    where: { entry: { tenantId: params.tenantId, entryDate: { gte: params.from, lte: params.to } } },
    select: { debitCents: true, creditCents: true, account: { select: { code: true, name: true, type: true } } },
  });

  const byAccount = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
  for (const line of lines) {
    const key = line.account.code;
    const row = byAccount.get(key) ?? { code: line.account.code, name: line.account.name, type: line.account.type, debit: 0, credit: 0 };
    row.debit += line.debitCents;
    row.credit += line.creditCents;
    byAccount.set(key, row);
  }

  const ordered = [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
  const rows = ordered.map((row) => ({
    Code: row.code,
    Account: row.name,
    Type: row.type,
    Debit: units(row.debit),
    Credit: units(row.credit),
    Balance: units(row.debit - row.credit),
    Currency: tenant.currency,
  }));

  const debit = ordered.reduce((sum, r) => sum + r.debit, 0);
  const credit = ordered.reduce((sum, r) => sum + r.credit, 0);
  const notes = [
    `${params.from.toISOString().slice(0, 10)} to ${params.to.toISOString().slice(0, 10)}. Debits ${units(debit)}, credits ${units(credit)}.`,
  ];
  if (debit !== credit) {
    notes.push(
      `The two columns do not agree — a difference of ${units(Math.abs(debit - credit))}. That is worth looking at before the books go anywhere.`,
    );
  }
  if (ordered.length === 0) notes.push("Nothing was posted to the ledger in this period.");

  return {
    fileName: `${tenant.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-trial-balance-${params.to.toISOString().slice(0, 10)}.csv`,
    csv: objectsToCsv(rows),
    rows: rows.length,
    notes,
  };
}
