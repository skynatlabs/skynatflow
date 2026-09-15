// A spreadsheet, whatever it was saved as, as tables of text.
//
// Stock lists and customer lists arrive as .xlsx from Excel, as .csv from
// everything else, and as semicolon-separated .csv from Excel set up for a
// country that writes decimals with a comma. Real ones also start with a
// title, a date and a blank line before the column headings. This finds the
// headings and hands back the rows under them; what the columns mean is
// decided elsewhere.

import { parseCsv } from "./csv";
import { readXlsx } from "./xlsx";

export interface SheetTable {
  /** The sheet's name, or the file's for a CSV. */
  name: string;
  headers: string[];
  rows: string[][];
}

export function isSpreadsheet(fileName: string, mediaType: string): boolean {
  return (
    /\.(xlsx|csv|tsv|txt)$/i.test(fileName) ||
    mediaType === "text/csv" ||
    mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

const nonEmpty = (row: string[]) => row.filter((c) => c.trim() !== "").length;
const isNumberish = (c: string) => /^[\s\-+R$€£]*[\d\s.,]+%?\s*$/.test(c);

/**
 * The row the headings are on: the first of the top rows that has several
 * cells, mostly words rather than numbers, followed by a row of about as many
 * cells. A title row has one cell; a data row is mostly numbers.
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 15);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].filter((c) => c.trim() !== "");
    if (cells.length < 2) continue;
    const words = cells.filter((c) => !isNumberish(c)).length;
    const next = rows.slice(i + 1, i + 4).find((r) => nonEmpty(r) > 0);
    const follows = next ? Math.min(nonEmpty(next), cells.length) / cells.length : 0;
    const score = (words / cells.length) * 2 + follows + Math.min(cells.length, 8) / 8;
    if (words / cells.length >= 0.6 && score > bestScore) {
      best = i;
      bestScore = score;
    }
    // The first plausible heading row wins once rows beneath it look like data.
    if (best === i && follows >= 0.5) break;
  }
  return best >= 0 ? best : Math.max(0, rows.findIndex((r) => nonEmpty(r) > 0));
}

function toTable(name: string, all: string[][]): SheetTable | null {
  const rows = all.map((r) => r.map((c) => (c ?? "").trim()));
  if (rows.every((r) => nonEmpty(r) === 0)) return null;
  const h = findHeaderRow(rows);
  const headers = rows[h] ?? [];
  const width = Math.max(headers.length, ...rows.slice(h + 1).map((r) => r.length));
  const padded = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  return {
    name,
    headers: padded(headers).map((c, i) => c || `Column ${i + 1}`),
    rows: rows.slice(h + 1).filter((r) => nonEmpty(r) > 0).map(padded),
  };
}

function delimiterOf(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
  const count = (ch: string) => firstLines.split(ch).length - 1;
  const tabs = count("\t");
  const semis = count(";");
  const commas = count(",");
  if (tabs > commas && tabs > semis) return "\t";
  return semis > commas ? ";" : ",";
}

/** Every non-empty table in the file. Throws with a readable message when it cannot be read. */
export function readSpreadsheet(fileName: string, data: Buffer): SheetTable[] {
  if (/\.xls$/i.test(fileName)) {
    throw new Error("That is an old Excel file (.xls). Open it in Excel and save it as .xlsx, then bring it in again.");
  }
  if (/\.xlsx$/i.test(fileName) || (data[0] === 0x50 && data[1] === 0x4b)) {
    return readXlsx(data)
      .map((s) => toTable(s.name, s.rows))
      .filter((t): t is SheetTable => t !== null);
  }
  const text = data.toString("utf8");
  const { headers, rows } = parseCsv(text, delimiterOf(text));
  const table = toTable(fileName, [headers, ...rows]);
  return table ? [table] : [];
}

/**
 * Money as people type it in a spreadsheet, in cents: "R 1 234,50",
 * "1,234.50", "1.234,50", "450". The last separator followed by one or two
 * digits is the decimal point; everything else is grouping.
 */
export function parseMoneyCents(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/\s|[A-Za-z$€£₦]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-+]/g, "");
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  let whole = s;
  let fraction = "";
  if (lastSep >= 0 && /^\d{1,2}$/.test(s.slice(lastSep + 1))) {
    whole = s.slice(0, lastSep);
    fraction = s.slice(lastSep + 1);
  }
  whole = whole.replace(/[.,]/g, "");
  if (!/^\d*$/.test(whole) || (!whole && !fraction)) return null;
  const cents = Number(whole || "0") * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isFinite(cents) ? (negative ? -cents : cents) : null;
}

/** A quantity: "12", "12.5", "1 200", "12,5". */
export function parseQuantity(raw: string | null | undefined): number | null {
  const cents = parseMoneyCents(raw);
  return cents === null ? null : cents / 100;
}
