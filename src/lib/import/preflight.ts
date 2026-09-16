// What would actually land, before anything does.
//
// The moment a migration goes wrong is the moment somebody clicks Import on
// four thousand rows and finds out afterwards that the amount column was read
// as text, or that half the customers were created twice because the old
// system spells the name differently from the phone book.
//
// There is no undo that fixes that properly — rows can be deleted, but a
// business that has just watched its customer list double does not trust the
// software again. So the fix is before, not after: read the file, say exactly
// what would happen, and let somebody look at it.

import { parseAmountCents } from "./documents";

export interface Preflight {
  /** Rows that would create something new. */
  wouldCreate: number;
  /** Rows that match something already here. */
  wouldMatch: number;
  /** Rows that would be skipped, with the reason. */
  wouldSkip: Array<{ row: number; why: string }>;
  /** The first few, so somebody can look at real values rather than counts. */
  sample: Array<Record<string, string>>;
  /** Columns in the file that nothing is reading. */
  ignoredColumns: string[];
  /** Anything worth saying out loud before the button is pressed. */
  warnings: string[];
}

/**
 * A dry run.
 *
 * Takes the records exactly as the import would receive them, plus what is
 * already here, and answers the only question that matters: how many new
 * things, how many matches, and what goes wrong.
 */
export function preflight(params: {
  target: "customers" | "products" | "quotes" | "invoices";
  records: Array<Record<string, string>>;
  /** Headers from the file, so a column nothing reads can be named. */
  headers: string[];
  /** What the mapping actually uses. */
  mappedColumns: string[];
  /** Names, SKUs or references already in the workspace, lowercased. */
  existing: Set<string>;
}): Preflight {
  const wouldSkip: Array<{ row: number; why: string }> = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  let wouldCreate = 0;
  let wouldMatch = 0;
  let unparseableAmounts = 0;
  let missingDates = 0;

  params.records.forEach((record, index) => {
    const row = index + 2; // header is row 1, as a spreadsheet counts

    const key =
      params.target === "customers"
        ? record.name?.trim().toLowerCase()
        : params.target === "products"
          ? (record.sku?.trim() || record.name?.trim())?.toLowerCase()
          : record.reference?.trim().toLowerCase();

    if (!key) {
      wouldSkip.push({
        row,
        why:
          params.target === "customers"
            ? "No name, so there would be nothing to call this customer."
            : params.target === "products"
              ? "No name and no code."
              : "No document number, so this could not be told apart from the next one.",
      });
      return;
    }

    // Two rows in the same file for the same thing is not a match against the
    // workspace — it is the file itself being wrong, and it is worth saying
    // separately because the cause is different.
    if (seen.has(key)) {
      wouldSkip.push({ row, why: `"${key}" appears more than once in this file. Only the first would be used.` });
      return;
    }
    seen.add(key);

    if (params.existing.has(key)) wouldMatch += 1;
    else wouldCreate += 1;

    if (params.target === "quotes" || params.target === "invoices" || params.target === "products") {
      const raw = record.amountCents ?? record.unitPriceCents ?? "";
      if (raw && parseAmountCents(raw) === null) unparseableAmounts += 1;
    }
    if ((params.target === "quotes" || params.target === "invoices") && !record.date) missingDates += 1;
  });

  if (unparseableAmounts > 0) {
    warnings.push(
      `${unparseableAmounts} ${unparseableAmounts === 1 ? "row has an amount" : "rows have amounts"} that cannot be read as money. Those would come in at zero — check whether the column is the right one.`,
    );
  }
  if (missingDates > 0) {
    warnings.push(`${missingDates} ${missingDates === 1 ? "row has" : "rows have"} no date, so ${missingDates === 1 ? "it" : "they"} would be dated today.`);
  }
  if (wouldMatch > 0 && params.target === "customers") {
    warnings.push(`${wouldMatch} already exist here and would be left exactly as they are rather than duplicated.`);
  }
  if (params.records.length > 2000) {
    warnings.push(`${params.records.length.toLocaleString()} rows is a big import. It is worth doing a hundred first and looking at them.`);
  }

  const mapped = new Set(params.mappedColumns);
  const ignoredColumns = params.headers.filter((header) => header && !mapped.has(header));

  return {
    wouldCreate,
    wouldMatch,
    wouldSkip: wouldSkip.slice(0, 50),
    sample: params.records.slice(0, 5),
    ignoredColumns,
    warnings,
  };
}

/** One sentence for the button's label, so nobody presses it blind. */
export function preflightSentence(result: Preflight, target: string): string {
  const parts: string[] = [];
  if (result.wouldCreate > 0) parts.push(`${result.wouldCreate.toLocaleString()} new ${target}`);
  if (result.wouldMatch > 0) parts.push(`${result.wouldMatch.toLocaleString()} already here`);
  if (result.wouldSkip.length > 0) parts.push(`${result.wouldSkip.length} skipped`);
  if (parts.length === 0) return "Nothing in this file would come in.";
  return `This would bring in ${parts.join(", ")}.`;
}
