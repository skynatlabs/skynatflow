// What the user is looking at when they ask.
//
// Without this, the agent is a search box that happens to be on every page:
// standing on an invoice and typing "chase this one" gets "which invoice?",
// because nothing told it. A person asking a colleague across the desk never
// has to say which one — the screen is the context.
//
// Deriving it from the URL rather than asking each page to declare it is
// deliberate. There are ninety-odd pages; a convention that needs ninety
// opt-ins is a convention that will be missed on the ninety-first.
//
// This produces a *hint*, never an authority. The id goes into the prompt as
// "the user is looking at Transaction X" and the model still has to fetch it
// with a tenant-scoped tool, which is what keeps a pasted URL from another
// workspace worthless.

export interface PageContext {
  /** Human phrasing for the prompt: "the invoice INV-1024". */
  description: string;
  /** Present when the page is about one record. */
  entity?: { type: string; id: string };
  /** What the person can see listed, when the page is a list. */
  listing?: string;
}

// Segments that sit where an id would but name an action instead. Without
// this, "/quotes/new" reads as the quote whose id is "new", and the agent
// starts every sentence on the new-quote page talking about a record that
// doesn't exist.
const RESERVED_SEGMENTS = new Set(["new", "import", "export", "create"]);

interface Route {
  /** Segments after /dashboard/<tenantId>/ */
  match: RegExp;
  entityType?: string;
  describe: (id: string | undefined, customerLabel: string) => string;
  listing?: (customerLabel: string) => string;
}

const ROUTES: Route[] = [
  {
    match: /^customers\/([^/]+)(?:\/.*)?$/,
    entityType: "Party",
    describe: (_id, label) => `one ${label.toLowerCase()}'s record`,
  },
  {
    match: /^quotes\/([^/]+)(?:\/.*)?$/,
    entityType: "Transaction",
    describe: () => "one quote",
  },
  {
    match: /^invoices\/([^/]+)(?:\/.*)?$/,
    entityType: "Transaction",
    describe: () => "one invoice",
  },
  {
    match: /^products\/([^/]+)(?:\/.*)?$/,
    entityType: "Item",
    describe: () => "one product",
  },
  {
    match: /^statements\/([^/]+)(?:\/.*)?$/,
    entityType: "Party",
    describe: (_id, label) => `a ${label.toLowerCase()}'s statement of account`,
  },
  {
    match: /^messages\/([^/]+)(?:\/.*)?$/,
    entityType: "MessageThread",
    describe: () => "an internal team conversation",
  },
];

// Pages that are a list or a workspace rather than one record. The label is
// what the agent should assume "these" or "this list" refers to.
const LISTINGS: Record<string, string> = {
  "": "the home dashboard",
  agent: "the agent console",
  today: "today's plan",
  inbox: "the notifications inbox",
  customers: "the customer list",
  products: "the product catalog",
  inventory: "stock levels",
  quotes: "the list of quotes",
  invoices: "the list of invoices",
  statements: "customer statements",
  "unsent-quotes": "quotes that were drafted but never sent",
  overdue: "overdue invoices",
  pipeline: "the sales pipeline",
  "job-cards": "job cards",
  appointments: "the appointment diary",
  tasks: "the task list",
  "ai-drafts": "AI-drafted messages waiting to be approved",
  disputes: "reports",
  connections: "wholesale trading connections",
  messages: "internal team conversations",
  goals: "business goals",
  expenses: "expenses",
  attendance: "staff attendance",
  org: "the org chart",
  "team-performance": "how the team is performing",
  fuel: "fuel logs",
  stocktake: "a stock count",
  "purchase-orders": "purchase orders",
  claims: "insurance claims",
  members: "members and donors",
  rentals: "rented-out items",
  properties: "properties",
  pos: "the point of sale till",
  staff: "staff and their roles",
  settings: "workspace settings",
  "this-week": "this week's work",
};

/**
 * Reads a dashboard pathname into something worth putting in a prompt.
 *
 * Returns null for anything unrecognised rather than guessing — a wrong
 * context is worse than none, because the model will act on it.
 */
export function describePage(params: {
  path: string;
  tenantId: string;
  customerLabel: string;
}): PageContext | null {
  const { path, tenantId, customerLabel } = params;
  if (typeof path !== "string") return null;

  const prefix = `/dashboard/${tenantId}`;
  if (!path.startsWith(prefix)) return null;

  const rest = path
    .slice(prefix.length)
    .replace(/^\/+/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");

  for (const route of ROUTES) {
    const hit = rest.match(route.match);
    if (!hit) continue;
    const id = hit[1];
    if (RESERVED_SEGMENTS.has(id)) break; // fall through to the listing below

    // Sub-pages of a record ("/invoices/x/pay") keep the record, not the leaf.
    return {
      description: route.describe(id, customerLabel),
      ...(route.entityType && id ? { entity: { type: route.entityType, id } } : {}),
    };
  }

  const top = rest.split("/")[0] ?? "";
  const listing = LISTINGS[top];
  if (listing) return { description: listing, listing };

  return null;
}

/** The lines that go into the system prompt. Empty when there's no context. */
export function pageContextPrompt(ctx: PageContext | null): string[] {
  if (!ctx) return [];

  const lines = [
    ``,
    `Right now the person is looking at ${ctx.description}.`,
  ];

  if (ctx.entity) {
    lines.push(
      `That record is ${ctx.entity.type} id ${ctx.entity.id}. When they say "this",` +
        ` "it", or "this one" without naming anything, they mean that record — look` +
        ` it up with your tools before acting on it, and say which one you acted on` +
        ` so they can see you understood.`
    );
  } else {
    lines.push(
      `If they say "these" or "this list" without naming anything, they mean what is` +
        ` on that page.`
    );
  }

  return lines;
}
