// Moving a business in.
//
// The properties that matter here are the ones that decide whether somebody
// finishes setting up: a spreadsheet kept the way a real business keeps it is
// read without a mapping exercise, the same price list brought in twice does
// not double the catalogue, and nothing already recorded is blanked by a
// document that was quiet about it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { readZip, writeZip } from "../../src/lib/import/zip";
import { findHeaderRow, parseMoneyCents, readSpreadsheet } from "../../src/lib/import/sheet";
import {
  guessCustomerColumns,
  guessProductColumns,
  priceIncludesTax,
  rowsToCustomers,
  rowsToProducts,
  tableLooksLike,
} from "../../src/lib/onboarding/columns";
import { emptyProposal, mergeProposals, narrate, type Proposal, type ProposedProduct } from "../../src/lib/onboarding/proposal";
import { applyProposal, upsertParties, upsertProducts } from "../../src/lib/onboarding/apply";
import { finishOnboarding, onboardingState, setStep, startWorkspace } from "../../src/lib/onboarding/progress";

let tenantId: string;
let userId: string;

beforeEach(async () => {
  const user = await prisma.user.create({ data: { email: `move-in-${Date.now()}-${Math.random()}@test.local`, name: "Owner" } });
  userId = user.id;
  const tenant = await startWorkspace({ userId, name: "Ndlovu Logistics", niche: "LOGISTICS", countryCode: "ZA" });
  tenantId = tenant.id;
});

afterEach(async () => {
  await prisma.intakeDocument.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.event.deleteMany({ where: { tenantId } });
  await prisma.domainEvent.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

// --------------------------------------------------------------- the files

/** A real .xlsx, built here so the reader is tested against the format itself. */
function workbook(sheets: Array<{ name: string; rows: (string | number)[][] }>): Buffer {
  const shared: string[] = [];
  const index = (s: string) => {
    const at = shared.indexOf(s);
    if (at >= 0) return at;
    shared.push(s);
    return shared.length - 1;
  };
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const letter = (i: number) => String.fromCharCode(65 + i);

  const sheetFiles = sheets.map((sheet) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) =>
            typeof cell === "number"
              ? `<c r="${letter(c)}${r + 1}"><v>${cell}</v></c>`
              : cell === ""
                ? ""
                : `<c r="${letter(c)}${r + 1}" t="s"><v>${index(cell)}</v></c>`
          )
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });

  return writeZip([
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        sheets.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `</Relationships>`,
    },
    { name: "xl/sharedStrings.xml", data: `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${escape(s)}</t></si>`).join("")}</sst>` },
    ...sheetFiles.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
  ]);
}

describe("the files a business actually has", () => {
  it("writes and reads a zip back unchanged", () => {
    const zip = writeZip([
      { name: "records/customers.csv", data: "Name,Phone\nJabu,0821234567\n" },
      { name: "records/notes.txt", data: Buffer.from("héllo — unicode".repeat(100)) },
    ]);
    const back = readZip(zip);
    expect(back.get("records/customers.csv")?.toString("utf8")).toBe("Name,Phone\nJabu,0821234567\n");
    expect(back.get("records/notes.txt")?.toString("utf8")).toBe("héllo — unicode".repeat(100));
  });

  it("reads an Excel stock list, past the title rows above the headings", () => {
    const file = workbook([
      {
        name: "Stock",
        rows: [
          ["NDLOVU LOGISTICS — STOCK LIST", "", "", ""],
          ["Printed 12 March 2026", "", "", ""],
          [],
          ["Stock code", "Description", "Selling price", "Qty on hand"],
          ["TYR-295", "Tyre 295/80 R22.5", 4250.5, 12],
          ["OIL-20L", "Engine oil 20L", 899, 3],
        ],
      },
    ]);

    const [table] = readSpreadsheet("stock.xlsx", file);
    expect(table.headers.slice(0, 4)).toEqual(["Stock code", "Description", "Selling price", "Qty on hand"]);
    expect(table.rows).toHaveLength(2);

    const mapping = guessProductColumns(table.headers);
    const products = rowsToProducts(table, mapping, "stock.xlsx");
    expect(products.map((p) => [p.sku, p.name, p.unitPriceCents, p.quantityOnHand])).toEqual([
      ["TYR-295", "Tyre 295/80 R22.5", 425050, 12],
      ["OIL-20L", "Engine oil 20L", 89900, 3],
    ]);
  });

  it("finds the heading row rather than assuming it is the first", () => {
    expect(findHeaderRow([["Price list"], [], ["Item", "Price"], ["Widget", "10"]])).toBe(2);
    expect(findHeaderRow([["Item", "Price"], ["Widget", "10"]])).toBe(0);
  });

  it("reads a semicolon CSV with prices written the South African way", () => {
    const csv = "Item;Price incl VAT;Cost;SOH\nDiesel filter;R 1 234,50;R 900,00;7\nBrake pads;R 2 500,00;;2\n";
    const [table] = readSpreadsheet("parts.csv", Buffer.from(csv, "utf8"));
    const mapping = guessProductColumns(table.headers);
    expect(priceIncludesTax(table.headers, mapping)).toBe(true);

    const products = rowsToProducts(table, mapping, "parts.csv", true);
    // R1 234,50 including 15% VAT is R1 073,48 before it.
    expect(products[0]).toMatchObject({ name: "Diesel filter", unitPriceCents: 107348, costCents: 90000, quantityOnHand: 7, taxRatePercent: 15 });
    expect(products[1].costCents).toBeNull();
  });

  it("parses money however it was typed", () => {
    expect(parseMoneyCents("R 1 234,50")).toBe(123450);
    expect(parseMoneyCents("1,234.50")).toBe(123450);
    expect(parseMoneyCents("1.234,50")).toBe(123450);
    expect(parseMoneyCents("450")).toBe(45000);
    expect(parseMoneyCents("(120.00)")).toBe(-12000);
    expect(parseMoneyCents("")).toBeNull();
    expect(parseMoneyCents("n/a")).toBeNull();
  });

  it("tells a stock list from a customer list by its columns", () => {
    const stock = readSpreadsheet("a.csv", Buffer.from("Item,Price,Qty\nBolt,10,4\n"))[0];
    const contacts = readSpreadsheet("b.csv", Buffer.from("Customer name,Email,Cell\nJabu Traders,jabu@example.com,0821234567\n"))[0];
    expect(tableLooksLike(stock)).toBe("products");
    expect(tableLooksLike(contacts)).toBe("customers");

    const customers = rowsToCustomers(contacts, guessCustomerColumns(contacts.headers), "b.csv");
    expect(customers[0]).toMatchObject({ name: "Jabu Traders", email: "jabu@example.com", phone: "0821234567" });
  });

  it("does not let a cost column take the price column", () => {
    const table = readSpreadsheet("c.csv", Buffer.from("Description,Cost price,Selling price\nWidget,10,25\n"))[0];
    const mapping = guessProductColumns(table.headers);
    const [product] = rowsToProducts(table, mapping, "c.csv");
    expect(product).toMatchObject({ name: "Widget", costCents: 1000, unitPriceCents: 2500 });
  });
});

// ----------------------------------------------------------- the proposal

function proposalWith(parts: Partial<Proposal>): Proposal {
  return { ...emptyProposal(), ...parts };
}

const product = (p: Partial<ProposedProduct> & { name: string }): ProposedProduct => ({
  key: p.name,
  sku: null,
  unit: null,
  unitPriceCents: null,
  costCents: null,
  quantityOnHand: null,
  taxRatePercent: null,
  category: null,
  source: "test",
  ...p,
});

describe("several documents, one list to confirm", () => {
  it("keeps the first answer and fills in what it did not say", () => {
    const certificate = proposalWith({
      business: { name: { value: "Ndlovu Logistics (Pty) Ltd", source: "cipc.pdf" }, registrationNumber: { value: "2019/123456/07", source: "cipc.pdf" } },
    });
    const invoice = proposalWith({
      business: { name: { value: "NDLOVU LOGISTICS", source: "invoice.pdf" }, vatNumber: { value: "4123456789", source: "invoice.pdf" } },
      customers: [{ key: "1", name: "Jabu Traders", companyName: null, email: "jabu@example.com", phone: null, vatNumber: null, address: null, source: "invoice.pdf" }],
      products: [product({ name: "Delivery — Johannesburg to Durban", unitPriceCents: 850000, source: "invoice.pdf" })],
    });
    const second = proposalWith({
      customers: [{ key: "2", name: "jabu traders", companyName: null, email: "jabu@example.com", phone: "0821234567", vatNumber: null, address: null, source: "invoice2.pdf" }],
      products: [product({ name: "delivery — johannesburg to durban", costCents: 500000, source: "invoice2.pdf" })],
    });

    const merged = mergeProposals(certificate, invoice, second);
    expect(merged.business.name?.value).toBe("Ndlovu Logistics (Pty) Ltd");
    expect(merged.business.name?.source).toBe("cipc.pdf");
    expect(merged.business.vatNumber?.value).toBe("4123456789");
    // The same customer and the same line, seen twice, arrive once.
    expect(merged.customers).toHaveLength(1);
    expect(merged.customers[0].phone).toBe("0821234567");
    expect(merged.products).toHaveLength(1);
    expect(merged.products[0]).toMatchObject({ unitPriceCents: 850000, costCents: 500000 });
  });

  it("says what it found in sentences, not field counts", () => {
    const lines = narrate(
      proposalWith({
        business: { name: { value: "Ndlovu Logistics", source: "cipc.pdf" }, vatNumber: { value: "412", source: "cipc.pdf" } },
        products: [product({ name: "Tyre", unitPriceCents: 100 }), product({ name: "Oil" })],
      })
    );
    expect(lines[0]).toContain("Ndlovu Logistics");
    expect(lines.join(" ")).toContain("VAT number");
    expect(lines.join(" ")).toContain("2 products");
  });
});

// -------------------------------------------------------------- writing it

describe("writing down what was confirmed", () => {
  it("brings the same price list in twice without doubling the catalogue", async () => {
    const rows = [product({ name: "Tyre 295/80", sku: "TYR-295", unitPriceCents: 425050, quantityOnHand: 12 })];
    const first = await upsertProducts(tenantId, rows);
    expect(first).toEqual({ created: 1, updated: 0 });

    const second = await upsertProducts(tenantId, [product({ name: "Tyre 295/80 R22.5", sku: "tyr-295", unitPriceCents: 450000 })]);
    expect(second).toEqual({ created: 0, updated: 1 });

    const items = await prisma.item.findMany({ where: { tenantId } });
    expect(items).toHaveLength(1);
    expect(items[0].unitPriceCents).toBe(450000);
    // The stock count the second list was quiet about is still there.
    expect(items[0].stockQty).toBe(12);
  });

  it("matches a customer by email before name, and never blanks what is on file", async () => {
    await upsertParties(
      tenantId,
      [{ key: "1", name: "Jabu Traders", companyName: null, email: "jabu@example.com", phone: "0821234567", vatNumber: null, address: null, source: "a" }],
      "CUSTOMER"
    );
    const again = await upsertParties(
      tenantId,
      [{ key: "2", name: "Jabu Traders CC", companyName: "Jabu Traders CC", email: "jabu@example.com", phone: null, vatNumber: "4999", address: null, source: "b" }],
      "CUSTOMER"
    );
    expect(again).toEqual({ created: 0, updated: 1 });

    const parties = await prisma.party.findMany({ where: { tenantId } });
    expect(parties).toHaveLength(1);
    expect(parties[0].phone).toBe("0821234567");
    expect(parties[0].vatNumber).toBe("4999");
  });

  it("saves the details, the certificate and the stock in one pass", async () => {
    const result = await applyProposal(tenantId, {
      business: {
        name: "Ndlovu Logistics (Pty) Ltd",
        registrationNumber: "2019/123456/07",
        vatNumber: "4123456789",
        businessAddress: "12 Main Road, Midrand",
        entityType: "Pty Ltd",
        countryCode: "ZA",
      },
      banking: { bankName: "FNB", bankAccountNumber: "62012345678", bankBranchCode: "250655" },
      obligations: [
        { key: "o1", title: "Tax clearance certificate", kind: "CERTIFICATE", authority: "SARS", reference: "TC-99", expiresOn: "2027-03-31", source: "sars.pdf" },
      ],
      customers: [{ key: "c1", name: "Jabu Traders", companyName: null, email: null, phone: "0821234567", vatNumber: null, address: null, source: "invoice.pdf" }],
      suppliers: [],
      products: [product({ name: "Delivery — JHB to DBN", unitPriceCents: 850000 })],
    });

    expect(result.problems).toEqual([]);
    expect(result.productsCreated).toBe(1);
    expect(result.customersCreated).toBe(1);
    expect(result.obligations).toBe(1);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.vatNumber).toBe("4123456789");
    expect(tenant.bankAccountNumber).toBe("62012345678");
    expect(tenant.name).toBe("Ndlovu Logistics (Pty) Ltd");

    const obligation = await prisma.obligation.findFirstOrThrow({ where: { tenantId } });
    expect(obligation.title).toBe("Tax clearance certificate");
    expect(obligation.dueAt.toISOString().slice(0, 10)).toBe("2027-03-31");

    // Confirming the same certificate again does not put it on the calendar twice.
    const twice = await applyProposal(tenantId, {
      business: {},
      banking: {},
      obligations: [{ key: "o1", title: "tax clearance certificate", kind: "CERTIFICATE", authority: "SARS", reference: "TC-99", expiresOn: "2027-03-31", source: "sars.pdf" }],
      customers: [],
      suppliers: [],
      products: [],
    });
    expect(twice.obligations).toBe(0);
    expect(await prisma.obligation.count({ where: { tenantId } })).toBe(1);
  });
});

// ------------------------------------------------------------- the progress

describe("how far along moving in is", () => {
  it("reads the steps off the workspace, and remembers where the owner was", async () => {
    let state = await onboardingState(tenantId);
    expect(state.finished).toBe(false);
    expect(state.step).toBe("details");
    expect(state.done.stock).toBe(false);
    expect(state.remaining.map((r) => r.key)).toEqual(["details", "stock", "customers", "look"]);

    await upsertProducts(tenantId, [product({ name: "Delivery", unitPriceCents: 100 })]);
    await setStep(tenantId, "customers");

    state = await onboardingState(tenantId);
    expect(state.done.stock).toBe(true);
    expect(state.step).toBe("customers");
    expect(state.remaining.map((r) => r.key)).not.toContain("stock");

    await finishOnboarding(tenantId);
    expect((await onboardingState(tenantId)).finished).toBe(true);
  });
});
