// A Word document, written by hand.
//
// People send proposals and quotes to customers who want to edit them —
// their lawyer adds a clause, their procurement officer fills in a code — and
// "can you send it in Word?" is asked in every deal. A .docx is a zip of
// WordprocessingML, and the subset a business document needs (headings,
// paragraphs, a table, bold text) is small enough to write directly. That
// keeps a document format out of the dependency list, and it opens in Word,
// WPS, LibreOffice and Google Docs alike.

import { writeZip } from "@/lib/import/zip";

export type DocxBlock =
  | { kind: "heading"; text: string; level?: 1 | 2 }
  | { kind: "paragraph"; text: string; bold?: boolean; muted?: boolean }
  | { kind: "spacer" }
  | { kind: "table"; header: string[]; rows: string[][]; align?: Array<"left" | "right"> };

const escape = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Word breaks lines on <w:br/>, not on the newline itself. */
function runs(text: string, opts: { bold?: boolean; muted?: boolean; size?: number } = {}) {
  const props =
    `<w:rPr>` +
    (opts.bold ? `<w:b/>` : "") +
    (opts.muted ? `<w:color w:val="6B7280"/>` : "") +
    (opts.size ? `<w:sz w:val="${opts.size * 2}"/><w:szCs w:val="${opts.size * 2}"/>` : "") +
    `</w:rPr>`;
  return String(text ?? "")
    .split("\n")
    .map((line, i) => `<w:r>${props}${i > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${escape(line)}</w:t></w:r>`)
    .join("");
}

function paragraph(text: string, opts: { bold?: boolean; muted?: boolean; size?: number; spaceAfter?: number } = {}) {
  return (
    `<w:p><w:pPr><w:spacing w:after="${opts.spaceAfter ?? 120}"/></w:pPr>` + runs(text, opts) + `</w:p>`
  );
}

function table(block: Extract<DocxBlock, { kind: "table" }>) {
  const cell = (text: string, i: number, bold = false) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="40"/>${block.align?.[i] === "right" ? "<w:jc w:val=\"right\"/>" : ""}</w:pPr>` +
    runs(text, { bold, size: 10 }) +
    `</w:p></w:tc>`;
  const header = `<w:tr>${block.header.map((h, i) => cell(h, i, true)).join("")}</w:tr>`;
  const body = block.rows.map((row) => `<w:tr>${row.map((c, i) => cell(c, i)).join("")}</w:tr>`).join("");
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>` +
    `<w:tblBorders>` +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>`)
      .join("") +
    `</w:tblBorders></w:tblPr>${header}${body}</w:tbl><w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`
  );
}

function render(blocks: DocxBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "heading":
          return paragraph(b.text, { bold: true, size: b.level === 2 ? 13 : 18, spaceAfter: 160 });
        case "paragraph":
          return paragraph(b.text, { bold: b.bold, muted: b.muted, size: 11 });
        case "spacer":
          return `<w:p/>`;
        case "table":
          return table(b);
      }
    })
    .join("");
}

/** A .docx anybody can open and edit. */
export function buildDocx(params: { title: string; blocks: DocxBlock[] }): Buffer {
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${render(params.blocks)}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>` +
    `</w:body></w:document>`;

  return writeZip([
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "docProps/core.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
        `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${escape(params.title)}</dc:title>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created>` +
        `</cp:coreProperties>`,
    },
    { name: "word/document.xml", data: document },
  ]);
}

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
