// Bank accounts and the statement lines that arrive in them.
//
// Importing a statement sounds like a parsing problem and is really a
// deduplication problem. People export overlapping date ranges, re-download
// the same month, and hand you the same line twice — so every line gets a
// fingerprint derived from what the bank actually said, and a second import
// of the same line is a no-op rather than a duplicated transaction and a
// wrong balance.
//
// The parser is deliberately tolerant. Every bank exports a different CSV and
// none of them will change for us, so columns are found by what their headers
// mean rather than by position, and a file that cannot be understood says so
// instead of importing half of itself.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { accountByCode, SYSTEM_ACCOUNTS } from "./ledger";

export interface CreateBankAccountParams {
  tenantId: string;
  name: string;
  last4?: string | null;
  /** Ledger account this posts through. Defaults to the system Bank account. */
  accountCode?: string;
  currency?: string;
}

export async function createBankAccount(params: CreateBankAccountParams) {
  const account = await accountByCode(
    params.tenantId,
    params.accountCode ?? SYSTEM_ACCOUNTS.bank
  );
  // Without a ledger account behind it a reconciled statement would balance
  // against nothing, so this is a hard requirement rather than a default.
  if (!account) throw new Error("Open your books first — there's no bank account to post through.");

  return prisma.bankAccount.create({
    data: {
      tenantId: params.tenantId,
      name: params.name.trim(),
      last4: params.last4?.replace(/\D/g, "").slice(-4) || null,
      accountId: account.id,
      currency: params.currency ?? "ZAR",
    },
  });
}

export async function listBankAccounts(tenantId: string) {
  return prisma.bankAccount.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    include: { account: { select: { code: true, name: true } } },
  });
}

// ------------------------------------------------------------------ parsing

export interface ParsedLine {
  postedOn: Date;
  description: string;
  /** Signed the way a statement reads: positive in, negative out. */
  amountCents: number;
  balanceCents: number | null;
  reference: string | null;
}

export interface ParseResult {
  lines: ParsedLine[];
  /** Rows that could not be read, with the reason. Reported, never dropped silently. */
  problems: string[];
}

const HEADER_PATTERNS: Record<string, RegExp> = {
  date: /^(date|transaction date|posting date|posted|value date|datum)$/i,
  description: /^(description|details|narrative|reference|memo|transaction|particulars|beskrywing)$/i,
  amount: /^(amount|value|transaction amount|bedrag)$/i,
  debit: /^(debit|debits|money out|withdrawal|paid out|uit)$/i,
  credit: /^(credit|credits|money in|deposit|paid in|in)$/i,
  balance: /^(balance|running balance|closing balance|saldo)$/i,
  reference: /^(reference|ref|payment reference|cheque|check number)$/i,
};

/** Split one CSV line, honouring quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((c) => c.trim().replace(/^"|"$/g, ""));
}

/**
 * Money as banks write it.
 *
 * Handles thousands separators in both conventions, currency symbols, and the
 * three ways a statement signals "out": a minus sign, trailing DR, or
 * parentheses.
 */
function parseAmount(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  const isParenNegative = /^\(.*\)$/.test(text);
  const isDr = /\bdr\b/i.test(text);
  let cleaned = text.replace(/[()]/g, "").replace(/\b(dr|cr)\b/gi, "").trim();

  // Strip anything that is not a digit, separator or sign.
  cleaned = cleaned.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  // Decide which separator is the decimal one by whichever comes last.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  const cents = Math.round(Math.abs(value) * 100);
  const negative = value < 0 || isParenNegative || isDr;
  return negative ? -cents : cents;
}

/** Dates as banks write them, which is every way there is. */
function parseDate(raw: string): Date | null {
  const text = raw.trim();
  if (!text) return null;

  // ISO first — unambiguous, so never guessed at.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 12));
  }

  // Day-first, which is the convention everywhere this product operates.
  // A US export would be misread, which is why the import screen states the
  // assumption rather than leaving it implicit.
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(text);
  if (dmy) {
    const year = +dmy[3] < 100 ? 2000 + +dmy[3] : +dmy[3];
    return new Date(Date.UTC(year, +dmy[2] - 1, +dmy[1], 12));
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12));
  }
  return null;
}

export function parseStatementCsv(csv: string): ParseResult {
  const problems: string[] = [];
  const rows = csv
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);

  if (rows.length < 2) return { lines: [], problems: ["That file has no rows in it."] };

  const headers = splitCsvLine(rows[0]);
  const columnFor = (key: keyof typeof HEADER_PATTERNS) =>
    headers.findIndex((h) => HEADER_PATTERNS[key].test(h));

  const dateCol = columnFor("date");
  const descCol = columnFor("description");
  const amountCol = columnFor("amount");
  const debitCol = columnFor("debit");
  const creditCol = columnFor("credit");
  const balanceCol = columnFor("balance");
  const refCol = columnFor("reference");

  if (dateCol === -1) {
    return {
      lines: [],
      problems: [
        `Couldn't find a date column. The headers read: ${headers.join(", ")}.`,
      ],
    };
  }
  if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
    return {
      lines: [],
      problems: [
        `Couldn't find an amount column, or a debit/credit pair. The headers read: ${headers.join(", ")}.`,
      ],
    };
  }

  const lines: ParsedLine[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = splitCsvLine(rows[i]);
    const postedOn = parseDate(cells[dateCol] ?? "");
    if (!postedOn) {
      problems.push(`Row ${i + 1}: couldn't read the date "${cells[dateCol] ?? ""}".`);
      continue;
    }

    let amountCents: number | null = null;
    if (amountCol !== -1) {
      amountCents = parseAmount(cells[amountCol] ?? "");
    } else {
      // Separate debit and credit columns: exactly one carries a value, and
      // a debit is money leaving whatever the column happens to be called.
      const debit = debitCol !== -1 ? parseAmount(cells[debitCol] ?? "") : null;
      const credit = creditCol !== -1 ? parseAmount(cells[creditCol] ?? "") : null;
      if (debit) amountCents = -Math.abs(debit);
      else if (credit) amountCents = Math.abs(credit);
    }

    if (amountCents === null || amountCents === 0) {
      problems.push(`Row ${i + 1}: no amount, or an amount of zero.`);
      continue;
    }

    lines.push({
      postedOn,
      description: (cells[descCol] ?? "").trim() || "(no description)",
      amountCents,
      balanceCents: balanceCol !== -1 ? parseAmount(cells[balanceCol] ?? "") : null,
      reference: refCol !== -1 ? (cells[refCol] ?? "").trim() || null : null,
    });
  }

  return { lines, problems };
}

// ---------------------------------------------------------------- importing

/**
 * A stable identity for a statement line.
 *
 * Derived from what the bank said rather than from row position, so the same
 * line in an overlapping export produces the same fingerprint and is skipped.
 * The balance is deliberately excluded: some exports omit it, and a line is
 * the same line whether or not the running total came with it.
 */
export function fingerprintLine(line: ParsedLine): string {
  const day = line.postedOn.toISOString().slice(0, 10);
  const normalised = line.description.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${day}|${line.amountCents}|${normalised}|${line.reference ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  problems: string[];
  from: Date | null;
  to: Date | null;
}

export async function importStatement(params: {
  tenantId: string;
  bankAccountId: string;
  csv: string;
}): Promise<ImportResult> {
  const account = await prisma.bankAccount.findUnique({
    where: { id: params.bankAccountId },
    select: { tenantId: true },
  });
  if (!account || account.tenantId !== params.tenantId) throw new Error("Bank account not found.");

  const { lines, problems } = parseStatementCsv(params.csv);
  if (lines.length === 0) return { imported: 0, duplicates: 0, problems, from: null, to: null };

  const existing = await prisma.bankTransaction.findMany({
    where: { bankAccountId: params.bankAccountId },
    select: { fingerprint: true },
  });
  const seen = new Set(existing.map((e) => e.fingerprint));

  const fresh = [];
  let duplicates = 0;
  for (const line of lines) {
    const fingerprint = fingerprintLine(line);
    // Two identical lines inside one file are genuinely possible — the same
    // amount to the same payee twice in a day — but indistinguishable from a
    // duplicate, so the conservative read is taken and reported.
    if (seen.has(fingerprint)) {
      duplicates++;
      continue;
    }
    seen.add(fingerprint);
    fresh.push({
      bankAccountId: params.bankAccountId,
      tenantId: params.tenantId,
      postedOn: line.postedOn,
      description: line.description,
      reference: line.reference,
      amountCents: line.amountCents,
      balanceCents: line.balanceCents,
      fingerprint,
    });
  }

  if (fresh.length > 0) {
    await prisma.bankTransaction.createMany({ data: fresh, skipDuplicates: true });
  }

  const dates = lines.map((l) => l.postedOn.getTime());
  const latest = lines.reduce((a, b) => (a.postedOn > b.postedOn ? a : b));

  await prisma.bankAccount.update({
    where: { id: params.bankAccountId },
    data: {
      lastStatementAt: latest.postedOn,
      ...(latest.balanceCents !== null
        ? { lastStatementBalanceCents: latest.balanceCents }
        : {}),
    },
  });

  return {
    imported: fresh.length,
    duplicates,
    problems,
    from: new Date(Math.min(...dates)),
    to: new Date(Math.max(...dates)),
  };
}

export async function listBankTransactions(
  tenantId: string,
  opts: { bankAccountId?: string; status?: "UNMATCHED" | "MATCHED" | "IGNORED"; limit?: number } = {}
) {
  return prisma.bankTransaction.findMany({
    where: {
      tenantId,
      ...(opts.bankAccountId ? { bankAccountId: opts.bankAccountId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { postedOn: "desc" },
    take: opts.limit ?? 200,
  });
}

/**
 * How far the books are from the bank.
 *
 * The number that tells somebody whether reconciling is worth their afternoon,
 * and the one thing a statement import is ultimately for.
 */
export async function reconciliationGap(tenantId: string, bankAccountId: string) {
  const account = await prisma.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: { tenantId: true, lastStatementBalanceCents: true, lastStatementAt: true },
  });
  if (!account || account.tenantId !== tenantId) throw new Error("Bank account not found.");

  const [unmatched, total] = await Promise.all([
    prisma.bankTransaction.count({ where: { bankAccountId, status: "UNMATCHED" } }),
    prisma.bankTransaction.count({ where: { bankAccountId } }),
  ]);

  const unmatchedSum = await prisma.bankTransaction.aggregate({
    where: { bankAccountId, status: "UNMATCHED" },
    _sum: { amountCents: true },
  });

  return {
    unmatched,
    total,
    matched: total - unmatched,
    unexplainedCents: unmatchedSum._sum.amountCents ?? 0,
    statementBalanceCents: account.lastStatementBalanceCents,
    statementAt: account.lastStatementAt,
  };
}
