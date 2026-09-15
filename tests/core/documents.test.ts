// Documents people send, and the formats they ask for them in.
//
// Two things are checked here because both are easy to get subtly wrong and
// impossible to notice: a line's own wording survives from quote to invoice
// (an invoice that renames what was agreed is a different document), and the
// Word file we hand over is a real .docx that opens rather than a zip that
// claims to be one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { createQuote, recordResponse, convertToInvoice } from "../../src/lib/core/money";
import { readZip } from "../../src/lib/import/zip";
import { buildDocx } from "../../src/lib/export/docx";
import { documentToDocx } from "../../src/lib/export/documentDocx";

let tenantId: string;
let partyId: string;
let itemId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Paper Co", niche: "SERVICES" } });
  tenantId = t.id;
  const p = await prisma.party.create({ data: { tenantId, name: "Mkhize Construction", role: "CUSTOMER" } });
  partyId = p.id;
  const i = await prisma.item.create({ data: { tenantId, name: "Site inspection", unitPriceCents: 250_000, unit: "visit" } });
  itemId = i.id;
});

afterEach(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("what a line says", () => {
  it("keeps its own wording, unit and order from quote to invoice", async () => {
    const quote = await createQuote({
      tenantId,
      partyId,
      lines: [
        { itemId, quantity: 2, unitPriceCents: 250_000, description: "Inspection — Sandton site, second visit", unit: "visit" },
        { itemId, quantity: 1, unitPriceCents: 120_000, description: "Report", sortOrder: 1 },
      ],
    });
    expect(quote.itemLines.map((l) => l.description)).toContain("Inspection — Sandton site, second visit");

    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });
    const lines = await prisma.transactionLine.findMany({ where: { transactionId: invoice.id }, orderBy: { sortOrder: "asc" } });

    expect(lines.map((l) => [l.description, l.unit, l.sortOrder])).toEqual([
      ["Inspection — Sandton site, second visit", "visit", 0],
      ["Report", null, 1],
    ]);
  });
});

describe("the Word file", () => {
  it("is a real docx: the parts Word looks for, with the text in them", () => {
    const data = buildDocx({
      title: "Test",
      blocks: [
        { kind: "heading", text: "Ndlovu Logistics" },
        { kind: "paragraph", text: "Line one\nline two" },
        { kind: "table", header: ["Item", "Amount"], rows: [["Delivery <Durban>", "R8 500"]], align: ["left", "right"] },
      ],
    });

    const files = readZip(data);
    expect([...files.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml"]);

    const xml = files.get("word/document.xml")!.toString("utf8");
    expect(xml).toContain("Ndlovu Logistics");
    // A newline is a break inside the paragraph, not a lost line.
    expect(xml).toContain("<w:br/>");
    // Angle brackets in a customer's name must not become markup.
    expect(xml).toContain("Delivery &lt;Durban&gt;");
    expect(xml).toContain("<w:tbl>");
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
  });

  it("carries the document's numbers, not a summary of them", () => {
    const { fileName, data } = documentToDocx({
      kind: "Invoice",
      number: "INV-000123",
      issuedAt: new Date("2026-03-01T10:00:00Z"),
      dueAt: new Date("2026-03-31T10:00:00Z"),
      currency: "ZAR",
      amountCents: 575_000,
      discountPercent: 0,
      business: { name: "Ndlovu Logistics", bankAccountNumber: "62012345678", bankName: "FNB" },
      customer: { name: "Mkhize Construction" },
      lines: [{ name: "Site inspection", quantity: 2, unit: "visit", unitPriceCents: 250_000, taxRatePercent: 15 }],
    });

    expect(fileName).toBe("invoice-INV-000123.docx");
    const xml = readZip(data).get("word/document.xml")!.toString("utf8");
    expect(xml).toContain("INV-000123");
    expect(xml).toContain("Mkhize Construction");
    // Two visits at R2 500 is R5 000, and 15% tax takes it to R5 750. The
    // space inside a formatted amount is the one the locale uses, not a plain one.
    expect(xml.replace(/\s/g, " ")).toContain("R5 750");
    // An invoice says where to pay.
    expect(xml).toContain("62012345678");
  });
});
