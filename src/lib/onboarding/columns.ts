// What the columns of somebody else's spreadsheet mean.
//
// Nobody names their columns the way we would. "Stock code", "Item", "Selling
// price incl", "SOH", "Qty on hand" — all of it is ordinary, and all of it has
// to land in the right field without the owner doing a mapping exercise on a
// phone. The words are matched first, because that is free, certain and works
// with no AI provider configured; the model is asked only about the columns
// the words could not place.

import { parseMoneyCents, parseQuantity, type SheetTable } from "@/lib/import/sheet";
import type { ProposedParty, ProposedProduct } from "./proposal";

export const PRODUCT_FIELDS = ["name", "sku", "description", "unitPrice", "cost", "quantity", "unit", "category", "taxRate"] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];

export const CUSTOMER_FIELDS = ["name", "companyName", "email", "phone", "vatNumber", "address", "city", "postalCode"] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

export type Mapping<F extends string> = Partial<Record<F, number>>;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, "");

const PRODUCT_WORDS: Record<ProductField, string[]> = {
  name: ["name", "productname", "itemname", "product", "item", "description", "itemdescription", "productdescription", "service", "title", "stockitem"],
  sku: ["sku", "code", "itemcode", "productcode", "stockcode", "partnumber", "partno", "barcode", "ref", "reference"],
  description: ["description", "details", "longdescription", "notes"],
  unitPrice: ["price", "unitprice", "sellingprice", "sellprice", "saleprice", "retail", "retailprice", "rate", "amount", "priceeach", "priceinclvat", "priceexclvat", "sellinginclvat", "unitsellingprice"],
  cost: ["cost", "costprice", "unitcost", "buyprice", "buyingprice", "purchaseprice", "landedcost", "supplierprice", "wholesale"],
  quantity: ["qty", "quantity", "stock", "stockonhand", "onhand", "qtyonhand", "soh", "instock", "available", "count", "units", "openingstock"],
  unit: ["unit", "uom", "unitofmeasure", "measure", "packsize", "per"],
  category: ["category", "group", "type", "department", "class", "range", "brand"],
  taxRate: ["vat", "vat%", "vatrate", "tax", "taxrate", "tax%"],
};

const CUSTOMER_WORDS: Record<CustomerField, string[]> = {
  name: ["name", "customer", "customername", "client", "clientname", "contact", "contactname", "fullname", "account", "accountname", "patient", "patientname"],
  companyName: ["company", "companyname", "business", "businessname", "organisation", "organization", "trading", "tradingas"],
  email: ["email", "emailaddress", "mail", "contactemail"],
  phone: ["phone", "mobile", "cell", "cellphone", "telephone", "tel", "number", "whatsapp", "contactnumber"],
  vatNumber: ["vat", "vatnumber", "vatno", "taxnumber"],
  address: ["address", "addressline", "street", "streetaddress", "physicaladdress", "deliveryaddress"],
  city: ["city", "town", "suburb"],
  postalCode: ["postal", "postalcode", "postcode", "zip", "zipcode"],
};

function match<F extends string>(headers: string[], words: Record<F, string[]>, fields: readonly F[]): Mapping<F> {
  const keys = headers.map(key);
  const taken = new Set<number>();
  const out: Mapping<F> = {};
  // Exact names first across every field, then looser containment, so
  // "Cost price" never takes the column called "Price".
  for (const exact of [true, false]) {
    for (const field of fields) {
      if (out[field] !== undefined) continue;
      const candidates = words[field];
      const at = keys.findIndex(
        (h, i) => !taken.has(i) && h !== "" && (exact ? candidates.includes(h) : candidates.some((c) => c.length > 3 && h.includes(c)))
      );
      if (at >= 0) {
        out[field] = at;
        taken.add(at);
      }
    }
  }
  return out;
}

export function guessProductColumns(headers: string[]): Mapping<ProductField> {
  const m = match(headers, PRODUCT_WORDS, PRODUCT_FIELDS);
  // A sheet with a description column and no name column sells the
  // description — it is what is printed on the invoice either way.
  if (m.name === undefined && m.description !== undefined) {
    m.name = m.description;
    delete m.description;
  }
  return m;
}

export function guessCustomerColumns(headers: string[]): Mapping<CustomerField> {
  return match(headers, CUSTOMER_WORDS, CUSTOMER_FIELDS);
}

/** Prices in a column headed "incl" already carry the tax. */
export function priceIncludesTax(headers: string[], mapping: Mapping<ProductField>): boolean {
  const at = mapping.unitPrice;
  if (at === undefined) return false;
  return /incl/i.test(headers[at] ?? "");
}

/**
 * Which kind of list this is. A stock list has prices or quantities; a
 * contact list has emails or phone numbers and neither.
 */
export function tableLooksLike(table: SheetTable): "products" | "customers" | "unknown" {
  const p = guessProductColumns(table.headers);
  const c = guessCustomerColumns(table.headers);
  const productSignals = [p.unitPrice, p.cost, p.quantity, p.sku].filter((x) => x !== undefined).length;
  const customerSignals = [c.email, c.phone, c.vatNumber, c.address].filter((x) => x !== undefined).length;
  if (productSignals > customerSignals && p.name !== undefined) return "products";
  if (customerSignals > 0 && c.name !== undefined) return "customers";
  if (p.name !== undefined && productSignals > 0) return "products";
  return "unknown";
}

const clean = (s: string | undefined) => {
  const v = (s ?? "").trim();
  return v === "" || v === "-" ? null : v;
};

export function rowsToProducts(table: SheetTable, mapping: Mapping<ProductField>, source: string, inclusive = false): ProposedProduct[] {
  const at = (row: string[], f: ProductField) => (mapping[f] === undefined ? null : clean(row[mapping[f]!]));
  const out: ProposedProduct[] = [];
  for (const [i, row] of table.rows.entries()) {
    const name = at(row, "name");
    if (!name) continue;
    const taxRate = at(row, "taxRate");
    const rate = taxRate === null ? null : Math.round(parseQuantity(taxRate) ?? 0);
    const listed = parseMoneyCents(at(row, "unitPrice"));
    // A price shown including tax is stored without it, because that is what
    // every line on a document is built from.
    const percent = rate ?? (inclusive ? 15 : null);
    const unitPriceCents =
      listed !== null && inclusive && percent ? Math.round(listed / (1 + percent / 100)) : listed;
    out.push({
      key: `${source}:${i}`,
      name,
      sku: at(row, "sku"),
      unit: at(row, "unit"),
      unitPriceCents,
      costCents: parseMoneyCents(at(row, "cost")),
      quantityOnHand: (() => {
        const q = at(row, "quantity");
        const n = q === null ? null : parseQuantity(q);
        return n === null ? null : Math.round(n);
      })(),
      taxRatePercent: percent,
      category: at(row, "category"),
      source,
    });
  }
  return out;
}

export function rowsToCustomers(table: SheetTable, mapping: Mapping<CustomerField>, source: string): ProposedParty[] {
  const at = (row: string[], f: CustomerField) => (mapping[f] === undefined ? null : clean(row[mapping[f]!]));
  const out: ProposedParty[] = [];
  for (const [i, row] of table.rows.entries()) {
    const name = at(row, "name") ?? at(row, "companyName");
    if (!name) continue;
    const address = [at(row, "address"), at(row, "city"), at(row, "postalCode")].filter(Boolean).join(", ") || null;
    out.push({
      key: `${source}:${i}`,
      name,
      companyName: at(row, "companyName"),
      email: at(row, "email"),
      phone: at(row, "phone"),
      vatNumber: at(row, "vatNumber"),
      address,
      source,
    });
  }
  return out;
}
