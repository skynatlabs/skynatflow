// Reading an Excel workbook into rows of text.
//
// Most businesses keep their stock list and their customers in Excel, and
// asking them to "save as CSV" first is a step half of them will not know how
// to take. This reads the cells — shared strings, inline strings, numbers and
// booleans — from every sheet. Formatting, formulas and dates-as-dates are
// deliberately out of scope: a stock list needs its names, codes, prices and
// quantities, and a formula's last calculated value is what is stored anyway.

import { readZip, ZipError } from "./zip";

export interface Sheet {
  name: string;
  rows: string[][];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** All the text runs inside one element, joined — rich text is several runs. */
function texts(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decode(m[1]);
  return out;
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rAttr = rowMatch[1].match(/\br="(\d+)"/);
    const rowIndex = rAttr ? Number(rAttr[1]) - 1 : rows.length;
    const cells: string[] = [];
    let next = 0;
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1];
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = v !== undefined ? shared[Number(v)] ?? "" : "";
      else if (type === "inlineStr") value = texts(body);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = decode(v);
      cells[col] = value.trim();
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    // Rows keep their place, so a blank row in the sheet is a blank row here.
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

/** Every sheet in the workbook, in order, as rows of trimmed text. */
export function readXlsx(buf: Buffer): Sheet[] {
  let files: Map<string, Buffer>;
  try {
    files = readZip(buf);
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError("The workbook could not be opened.");
  }
  const text = (path: string) => files.get(path)?.toString("utf8");

  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new ZipError("This does not look like an Excel workbook (.xlsx).");

  const shared = [...(text("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));

  const rels = new Map<string, string>();
  for (const m of (text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(m[0].match(/\bname="([^"]*)"/)?.[1] ?? `Sheet ${sheets.length + 1}`);
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    const path = (rid && rels.get(rid)) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = text(path);
    if (xml) sheets.push({ name, rows: sheetRows(xml, shared) });
  }
  return sheets;
}
