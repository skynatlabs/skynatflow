// Minimal RFC-4180-ish CSV parser — no dependency needed for the shape of
// export every accounting tool (Zoho Invoice, QuickBooks, FreshBooks,
// Wave, Xero) actually produces: comma-delimited, double-quote escaped,
// header row first. Handles quoted fields containing commas/newlines.

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM if present — Excel loves to add one.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.length > 0) || row.length > 1) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  return { headers: headers ?? [], rows: dataRows };
}

// Column-name presets so a Zoho/QuickBooks/FreshBooks/Wave/Xero export
// pre-fills the mapping step instead of the owner guessing which header
// means what.
export const IMPORT_PRESETS: Record<
  string,
  { label: string; customers?: Record<string, string[]>; products?: Record<string, string[]> }
> = {
  zoho: {
    label: "Zoho Invoice / Zoho Books",
    customers: {
      name: ["Display Name", "Customer Name", "Company Name"],
      phone: ["Phone", "Mobile", "WorkPhone"],
      email: ["EmailID", "Email"],
    },
    products: {
      name: ["Item Name", "Name"],
      sku: ["SKU", "Item SKU"],
      unitPriceCents: ["Rate", "Sales Price", "Price"],
      category: ["Category Name", "Category"],
    },
  },
  quickbooks: {
    label: "QuickBooks",
    customers: {
      name: ["Customer", "Customer full name", "Company"],
      phone: ["Phone Numbers", "Main Phone"],
      email: ["Email", "Main Email"],
    },
    products: {
      name: ["Product/Service Name", "Item"],
      sku: ["SKU"],
      unitPriceCents: ["Sales Price", "Price"],
      category: ["Category"],
    },
  },
  freshbooks: {
    label: "FreshBooks",
    customers: {
      name: ["Organization", "Client Name", "Name"],
      phone: ["Phone"],
      email: ["Email"],
    },
    products: {
      name: ["Item Name", "Description"],
      unitPriceCents: ["Unit Cost", "Rate"],
    },
  },
  wave: {
    label: "Wave",
    customers: {
      name: ["Customer Name", "Name"],
      phone: ["Phone"],
      email: ["Email"],
    },
    products: {
      name: ["Product Name", "Name"],
      unitPriceCents: ["Price", "Sale Price"],
    },
  },
  xero: {
    label: "Xero",
    customers: {
      name: ["*ContactName", "ContactName"],
      phone: ["Phone"],
      email: ["EmailAddress"],
    },
    products: {
      name: ["*ItemCode", "ItemName", "Description"],
      sku: ["ItemCode"],
      unitPriceCents: ["SalesUnitPrice", "PurchasesUnitPrice"],
    },
  },
  generic: { label: "Generic CSV (map columns manually)" },
};

export const TARGET_FIELDS = {
  customers: [
    { key: "name", label: "Name", required: true },
    { key: "phone", label: "Phone (WhatsApp)", required: false },
    { key: "email", label: "Email", required: false },
  ],
  products: [
    { key: "name", label: "Name", required: true },
    { key: "sku", label: "SKU", required: false },
    { key: "unitPriceCents", label: "Price", required: true },
    { key: "category", label: "Category", required: false },
  ],
} as const;

export function guessMapping(
  headers: string[],
  preset: Record<string, string[]> | undefined
): Record<string, string> {
  const mapping: Record<string, string> = {};
  if (!preset) return mapping;
  for (const [field, candidates] of Object.entries(preset)) {
    const match = headers.find((h) => candidates.some((c) => c.toLowerCase() === h.toLowerCase()));
    if (match) mapping[field] = match;
  }
  return mapping;
}
