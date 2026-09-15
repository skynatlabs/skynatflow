// Reading what a business already has.
//
// A registration certificate, a bank letter, last month's invoice, a price
// list in Excel, a photograph of the stock book on the counter. All of it
// already holds what setting up would otherwise ask somebody to type: the
// registered name and number, the VAT number, the bank account, the
// customers, what they sell and for how much.
//
// Two rules keep this honest. Nothing is invented — a field the document does
// not state comes back null rather than plausible. And nothing is written:
// this produces a proposal the owner confirms, because a wrong VAT number
// read off a smudged scan is worse than an empty one.
//
// Spreadsheets never reach the model. Columns are matched by their words,
// which costs nothing, works with no provider configured, and is right more
// often than a model asked to read ten thousand rows.

import { generateObject } from "ai";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { getAiModel } from "@/lib/ai/model";
import { isSpreadsheet, readSpreadsheet } from "@/lib/import/sheet";
import {
  guessCustomerColumns,
  guessProductColumns,
  priceIncludesTax,
  rowsToCustomers,
  rowsToProducts,
  tableLooksLike,
} from "./columns";
import {
  emptyProposal,
  mergeProposals,
  type IntakeKind,
  type Proposal,
  type ProposedParty,
  type ProposedProduct,
} from "./proposal";

const NICHES = Object.keys(NICHE_CONFIGS) as [string, ...string[]];
const OBLIGATION_KINDS = ["COMPLIANCE_FILING", "LICENCE", "CERTIFICATE", "TAX", "INSURANCE", "CONTRACT", "WARRANTY", "DOCUMENT"] as const;

const KINDS = [
  "company_registration",
  "vat_registration",
  "tax_certificate",
  "bbbee_certificate",
  "bank_letter",
  "sales_document",
  "supplier_document",
  "price_list",
  "stock_sheet",
  "contact_list",
  "letterhead",
  "other",
] as const;

const PartySchema = z.object({
  name: z.string(),
  companyName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  vatNumber: z.string().nullable(),
  address: z.string().nullable(),
});

const ProductSchema = z.object({
  name: z.string().describe("What it is called on the document, as printed."),
  sku: z.string().nullable().describe("Item, stock or part code, when one is shown."),
  unit: z.string().nullable().describe("What it is sold by — each, hour, kg, litre — when shown."),
  unitPriceCents: z.number().int().nullable().describe("Price for one, in cents. Null when no price is printed."),
  costCents: z.number().int().nullable().describe("What the business pays for one, in cents — only on a document from a supplier."),
  quantityOnHand: z.number().int().nullable().describe("Units in stock, only on a stock sheet that states them."),
  taxRatePercent: z.number().int().nullable().describe("Tax rate on this line, as a whole percent, when the document says."),
  category: z.string().nullable(),
});

const Reading = z.object({
  kind: z.enum(KINDS),
  summary: z.string().nullable().describe("One sentence: what this document is, naming the business on it."),
  business: z.object({
    name: z.string().nullable().describe("The registered name of the business setting up."),
    tradingName: z.string().nullable(),
    registrationNumber: z.string().nullable(),
    registeredOn: z.string().nullable().describe("YYYY-MM-DD, when the document states the registration date."),
    entityType: z.string().nullable().describe("As printed: Pty Ltd, CC, Sole Proprietor, NPC."),
    vatNumber: z.string().nullable(),
    businessAddress: z.string().nullable(),
    businessEmail: z.string().nullable(),
    businessPhone: z.string().nullable(),
    website: z.string().nullable(),
    countryCode: z.string().nullable().describe("ISO 3166-1 alpha-2, when the document makes the country plain."),
  }),
  suggestedNiche: z.enum(NICHES).nullable().describe("Which trade this business is in, judging by the document."),
  banking: z.object({
    bankName: z.string().nullable(),
    bankAccountHolder: z.string().nullable(),
    bankAccountNumber: z.string().nullable(),
    bankBranchCode: z.string().nullable(),
    bankSwift: z.string().nullable(),
  }),
  obligations: z
    .array(
      z.object({
        title: z.string().describe("What the certificate is, in the words a person would use."),
        kind: z.enum(OBLIGATION_KINDS),
        authority: z.string().nullable().describe("Who issued it."),
        reference: z.string().nullable(),
        expiresOn: z.string().nullable().describe("YYYY-MM-DD. Null unless an expiry or renewal date is printed."),
      })
    )
    .describe("Certificates, licences and registrations this document IS or names, with their dates."),
  customers: z.array(PartySchema).describe("Businesses or people this business sells to."),
  suppliers: z.array(PartySchema).describe("Businesses this business buys from."),
  products: z.array(ProductSchema),
  confidence: z.number().int().min(0).max(100).describe("How legible and unambiguous this document was."),
  notes: z.string().nullable().describe("Anything a person should check — a smudged number, a date that could be read two ways."),
});

type ReadingShape = z.infer<typeof Reading>;

export interface IntakeFile {
  name: string;
  mediaType: string;
  data: Buffer;
}

export interface IntakeContext {
  /** The business setting up, when it is already known — decides who is "us" on an invoice. */
  businessName?: string | null;
  countryCode?: string | null;
}

const READABLE_IMAGE = /^image\/(png|jpe?g|webp|gif)$/i;

function instructions(ctx: IntakeContext): string {
  return (
    `You are reading a document a business handed over while setting up its workspace.\n\n` +
    (ctx.businessName
      ? `The business setting up is "${ctx.businessName}". Anything issued BY them is a sales document: the letterhead is their own details, the party billed is their CUSTOMER, and the lines are what they sell, at their selling prices. Anything issued TO them is a supplier document: the issuer is a SUPPLIER and the line prices are costs, not selling prices.\n\n`
      : `Work out which party the document belongs to: on a registration certificate or a bank letter it is the subject; on an invoice it is the one on the letterhead issuing it, and the party billed is their customer.\n\n`) +
    `Rules:\n` +
    `- Never invent a value. Anything not printed is null. A guessed VAT number is worse than none.\n` +
    `- Money is in cents, as a whole number. R1 234,50 is 123450.\n` +
    `- Dates are YYYY-MM-DD, only when printed.\n` +
    `- A price list or stock sheet gives products and nothing else; do not invent a customer for it.\n` +
    `- Only put a certificate in obligations if the document is one, or names one with a date.\n` +
    (ctx.countryCode ? `- The business is in ${ctx.countryCode}.\n` : "")
  );
}

function toProposal(r: ReadingShape, source: string): Proposal {
  const p = emptyProposal();
  const found = (v: string | null | undefined) => (v && v.trim() ? { value: v.trim(), source } : undefined);

  p.documents.push({
    fileName: source,
    kind: (KINDS as readonly string[]).includes(r.kind) ? (r.kind as IntakeKind) : "other",
    summary: r.summary,
    confidence: r.confidence,
    notes: r.notes,
  });

  for (const [k, v] of Object.entries(r.business)) {
    const f = found(v);
    if (f) p.business[k as keyof typeof p.business] = f;
  }
  for (const [k, v] of Object.entries(r.banking)) {
    const f = found(v);
    if (f) p.banking[k as keyof typeof p.banking] = f;
  }
  if (r.suggestedNiche) p.suggestedNiche = { value: r.suggestedNiche, source };

  p.obligations = r.obligations.map((o, i) => ({
    key: `${source}:o${i}`,
    title: o.title,
    kind: o.kind,
    authority: o.authority,
    reference: o.reference,
    expiresOn: o.expiresOn,
    source,
  }));

  const party = (x: z.infer<typeof PartySchema>, i: number, prefix: string): ProposedParty => ({
    key: `${source}:${prefix}${i}`,
    name: x.name,
    companyName: x.companyName,
    email: x.email,
    phone: x.phone,
    vatNumber: x.vatNumber,
    address: x.address,
    source,
  });
  p.customers = r.customers.filter((c) => c.name?.trim()).map((c, i) => party(c, i, "c"));
  p.suppliers = r.suppliers.filter((s) => s.name?.trim()).map((s, i) => party(s, i, "s"));

  p.products = r.products
    .filter((x) => x.name?.trim())
    .map((x, i): ProposedProduct => ({
      key: `${source}:p${i}`,
      name: x.name.trim(),
      sku: x.sku,
      unit: x.unit,
      unitPriceCents: x.unitPriceCents,
      costCents: x.costCents,
      quantityOnHand: x.quantityOnHand,
      taxRatePercent: x.taxRatePercent,
      category: x.category,
      source,
    }));

  return p;
}

async function ask(
  content: Array<{ type: "text"; text: string } | { type: "image"; image: string } | { type: "file"; data: Buffer; mediaType: string; filename?: string }>,
  source: string
): Promise<Proposal> {
  const model = await getAiModel();
  if (!model) {
    const p = emptyProposal();
    p.problems.push(`${source}: reading documents needs the AI provider, and none is configured yet.`);
    return p;
  }
  try {
    const { object } = await generateObject({
      model,
      schema: Reading,
      abortSignal: AbortSignal.timeout(90_000),
      maxRetries: 1,
      messages: [{ role: "user", content }],
    });
    return toProposal(object, source);
  } catch (err) {
    const p = emptyProposal();
    console.error(`[onboarding:intake] ${source} failed:`, err);
    p.problems.push(`${source}: could not be read. Try a clearer photograph, or type it in.`);
    return p;
  }
}

async function readOneFile(file: IntakeFile, ctx: IntakeContext): Promise<Proposal> {
  const source = file.name;

  if (isSpreadsheet(file.name, file.mediaType)) {
    const p = emptyProposal();
    let tables;
    try {
      tables = readSpreadsheet(file.name, file.data);
    } catch (err) {
      p.problems.push(`${source}: ${err instanceof Error ? err.message : "could not be opened."}`);
      return p;
    }
    for (const table of tables) {
      const where = tables.length > 1 ? `${source} · ${table.name}` : source;
      const looks = tableLooksLike(table);
      if (looks === "products") {
        const mapping = guessProductColumns(table.headers);
        p.products.push(...rowsToProducts(table, mapping, where, priceIncludesTax(table.headers, mapping)));
      } else if (looks === "customers") {
        p.customers.push(...rowsToCustomers(table, guessCustomerColumns(table.headers), where));
      } else {
        p.problems.push(
          `${where}: I could not tell what the columns mean. Name them — a Name column plus Price, Cost or Quantity for stock, or Name plus Email or Phone for customers.`
        );
        continue;
      }
      p.documents.push({
        fileName: where,
        kind: looks === "products" ? "price_list" : "contact_list",
        summary: `${table.rows.length.toLocaleString("en-US")} rows under ${table.headers.filter(Boolean).length} columns.`,
        confidence: null,
        notes: null,
      });
    }
    return p;
  }

  if (file.mediaType === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const direct = await ask(
      [
        { type: "text", text: instructions(ctx) },
        { type: "file", data: file.data, mediaType: "application/pdf", filename: file.name },
      ],
      source
    );
    if (direct.problems.length === 0) return direct;

    // A provider that will not take the file itself can still have the text.
    let text = "";
    try {
      text = (await new PDFParse({ data: file.data }).getText()).text.slice(0, 20_000);
    } catch {
      return direct;
    }
    if (!text.trim()) return direct;
    return ask([{ type: "text", text: `${instructions(ctx)}\nThe text of the document follows.\n\n${text}` }], source);
  }

  if (READABLE_IMAGE.test(file.mediaType)) {
    const dataUrl = `data:${file.mediaType};base64,${file.data.toString("base64")}`;
    return ask([{ type: "text", text: instructions(ctx) }, { type: "image", image: dataUrl }], source);
  }

  const p = emptyProposal();
  p.problems.push(
    /heic|heif/i.test(file.mediaType)
      ? `${source}: iPhone HEIC photographs cannot be read. In Settings → Camera → Formats choose "Most Compatible", or send it as a JPEG.`
      : `${source}: not a kind of file I can read. PDFs, photographs, Excel and CSV all work.`
  );
  return p;
}

/** Read everything handed over, a few at a time, into one proposal. */
export async function readIntakeFiles(files: IntakeFile[], ctx: IntakeContext = {}): Promise<Proposal> {
  const parts: Proposal[] = [];
  const queue = [...files];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      parts.push(await readOneFile(next, ctx));
    }
  });
  await Promise.all(workers);
  return mergeProposals(...parts);
}

/**
 * The same reading, from something the owner typed or said — "we charge R850
 * a callout and R450 for travel, and our VAT number is 4123456789".
 */
export async function readSpokenText(text: string, ctx: IntakeContext = {}): Promise<Proposal> {
  const said = text.trim().slice(0, 4_000);
  if (!said) return emptyProposal();
  const p = await ask(
    [
      {
        type: "text",
        text:
          `${instructions(ctx)}\nThere is no document this time — the owner said the following about their business. ` +
          `Take only what they actually said.\n\n"${said}"`,
      },
    ],
    "what you told me"
  );
  for (const d of p.documents) d.kind = "spoken";
  return p;
}
