// Which tools this particular request actually needs.
//
// Every run used to ship all 332 tool schemas to the model: 38,866 tokens,
// measured, before a single word of the business's own context. At a frontier
// model's input rate that is about twelve cents a run in overhead alone —
// more per active seat, per month, than a competitor charges for the whole
// seat. It is also the most cacheable thing we send, and we were re-sending
// it in full every turn.
//
// So: send the ones that could plausibly be used, and nothing else.
//
// This is deliberately LEXICAL rather than a model call or an embedding
// lookup. Three reasons, in order of how much they mattered:
//
//   IT COSTS NOTHING. A classifier call to decide which tools to send would
//   spend tokens to save tokens, and add a round trip to every request before
//   the user sees anything happen.
//
//   IT IS TESTABLE OFFLINE. The whole point of this layer is that it must not
//   hide a tool the model needed. That is a claim you can only hold by
//   testing it on every build, and a test that needs an API key is a test
//   that does not run. See tests/agent/tool-selection.test.ts.
//
//   IT CANNOT DRIFT. The index is built from the live tool set's own names
//   and descriptions, so a tool added tomorrow is indexed tomorrow. Nobody
//   has to remember to register it anywhere.
//
// The bar is RECALL, not precision. Offering a handful of tools that go
// unused costs a few hundred tokens. Withholding the one tool that would have
// answered the question makes the agent say it cannot do something it can do,
// which is the failure this whole file must never cause.

import type { ToolSet } from "ai";

/**
 * Always offered, whatever was asked.
 *
 * These are the tools that let the agent find its footing: resolve a name to
 * a record, look up what it already knows, and answer "how are we doing"
 * when the request was too vague to match anything at all. Withholding these
 * would turn a vague question into a refusal rather than a clarification.
 */
export const CORE_TOOLS = [
  "findCustomers",
  "findRecord",
  "findDocuments",
  "customerHistory",
  "everythingAboutThem",
  "listProducts",
  "searchProducts",
  "listTasks",
  "createTask",
  "recallFacts",
  "rememberFact",
  "theNumbers",
  "businessSnapshot",
  "whatToDoFirst",
] as const;

/**
 * How many tools a run may be offered, including the core set.
 *
 * Tuned against the eval corpus rather than chosen: low enough to cut the
 * bill by an order of magnitude, high enough that every case in
 * tests/agent/tool-selection.test.ts still gets the tool it needed.
 */
export const MAX_TOOLS = 40;

// Words that carry no signal in either a request or a tool name. "what",
// "who" and "how" are here despite appearing in tool names (whoToChase,
// howAmIDoing) because they are stripped from BOTH sides — a term that
// matches everything discriminates nothing.
const STOPWORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by", "can", "could",
  "did", "do", "does", "for", "from", "get", "give", "had", "has", "have", "how", "i",
  "if", "in", "into", "is", "it", "its", "just", "list", "me", "my", "of", "on", "one",
  "or", "our", "out", "please", "show", "so", "some", "tell", "that", "the", "their",
  "them", "then", "there", "they", "this", "to", "up", "us", "was", "we", "were", "what",
  "when", "where", "which", "who", "why", "will", "with", "would", "you", "your",
]);

/**
 * Business vocabulary, mapped to the words the tools are actually named in.
 *
 * A person asks who owes them money; the tool is called whoToChase. Neither
 * word appears in the other. This table is where that gap is closed, and it
 * is the part of this file most worth extending when a real request misses.
 */
const SYNONYMS: Record<string, string[]> = {
  owe: ["overdue", "chase", "balance", "debtor", "outstanding"],
  owes: ["overdue", "chase", "balance", "outstanding"],
  owing: ["overdue", "chase", "balance", "outstanding"],
  debt: ["overdue", "balance", "chase"],
  debtor: ["overdue", "chase", "balance"],
  late: ["overdue", "sla", "chase", "stale"],
  unpaid: ["overdue", "balance", "chase"],
  money: ["cash", "payment", "balance"],
  off: ["away", "leave", "absence"],
  // Equipment, as people name it. Somebody asks who has the drill; the tool
  // is called assetsHeldByPerson, and nothing about "drill" says "asset".
  drill: ["asset", "issue", "held"],
  laptop: ["asset", "issue", "held"],
  equipment: ["asset", "issue", "held", "maintenance"],
  machine: ["asset", "maintenance", "held"],
  ladder: ["asset", "issue", "held"],
  gear: ["asset", "issue", "held"],
  shedding: ["power", "schedule"],
  bill: ["supplier", "invoice", "cost"],
  bills: ["supplier", "invoice", "cost"],
  vendor: ["supplier"],
  vendors: ["supplier"],
  stock: ["inventory", "product", "stocktake", "reorder", "shrinkage"],
  inventory: ["stock", "product", "reorder"],
  reorder: ["stock", "product", "demand"],
  staff: ["team", "member", "employment", "attendance"],
  employee: ["staff", "team", "member", "employment"],
  employees: ["staff", "team", "member", "employment"],
  worker: ["staff", "team", "member"],
  wage: ["payroll", "staff", "cost"],
  wages: ["payroll", "staff", "cost"],
  salary: ["payroll", "staff", "cost"],
  payslip: ["payroll"],
  van: ["vehicle", "fleet", "trip", "fuel"],
  truck: ["vehicle", "fleet", "trip", "load"],
  car: ["vehicle", "fleet", "trip"],
  driver: ["trip", "fleet", "delivery", "field"],
  fuel: ["fuel", "vehicle", "trip", "cost"],
  client: ["customer", "party"],
  clients: ["customer", "party"],
  patient: ["customer", "party"],
  estimate: ["quote"],
  estimates: ["quote"],
  proposal: ["quote", "agreement", "proposal", "tender"],
  tender: ["tender", "proposal", "agreement", "quote"],
  contract: ["agreement", "signing", "proposal"],
  sign: ["signing", "signature", "agreement"],
  signature: ["signing", "agreement", "awaiting"],
  profit: ["profit", "margin", "loss"],
  loss: ["profit", "loss", "margin"],
  pl: ["profit", "loss"],
  cash: ["cash", "forecast", "bank"],
  afford: ["afford", "cash", "forecast"],
  runway: ["cash", "forecast"],
  bank: ["bank", "reconciliation", "statement", "feed"],
  reconcile: ["reconciliation", "bank", "match"],
  receipt: ["expense", "cost", "capture"],
  slip: ["expense", "cost", "capture"],
  expense: ["expense", "cost", "spending"],
  spend: ["spending", "cost", "expense"],
  spending: ["spending", "cost", "expense", "classify"],
  price: ["price", "reprice", "product", "margin"],
  pricing: ["price", "reprice", "margin"],
  discount: ["price", "reprice", "margin"],
  delivery: ["delivery", "deliver", "parcel", "courier", "proof"],
  deliver: ["delivery", "parcel", "courier"],
  shipment: ["delivery", "parcel", "courier"],
  courier: ["parcel", "delivery"],
  job: ["job", "checklist", "budget", "field"],
  jobs: ["job", "checklist", "budget", "field"],
  site: ["job", "field", "appointment", "trip"],
  diary: ["appointment", "booking", "day", "schedule"],
  calendar: ["appointment", "booking", "day", "obligation"],
  appointment: ["appointment", "booking", "day"],
  booking: ["booking", "appointment", "slot"],
  leave: ["leave", "away", "absence"],
  holiday: ["leave", "away"],
  sick: ["leave", "away", "attendance"],
  vat: ["vat", "tax", "return", "filing"],
  tax: ["tax", "vat", "return", "filing"],
  sars: ["vat", "tax", "filing", "obligation"],
  review: ["review", "reputation", "complaint"],
  rating: ["review", "reputation"],
  complaint: ["complaint", "incident", "review"],
  email: ["mail", "inbound", "message", "thread"],
  mail: ["mail", "message", "thread", "inbound"],
  whatsapp: ["whatsapp", "message", "broadcast", "link"],
  sms: ["message", "broadcast", "consent"],
  message: ["message", "thread", "conversation", "broadcast"],
  call: ["call", "missed", "answered", "log"],
  phone: ["call", "missed", "notification"],
  power: ["power", "schedule", "load"],
  electricity: ["power", "schedule"],
  loadshedding: ["power", "schedule"],
  property: ["property", "rental", "lease"],
  rent: ["rental", "property"],
  rental: ["rental", "property", "asset"],
  asset: ["asset", "depreciation", "register", "book"],
  depreciation: ["depreciation", "asset", "book"],
  audit: ["audit", "trial", "journal", "books"],
  journal: ["journal", "books", "posting", "entry"],
  ledger: ["books", "journal", "trial", "balance"],
  books: ["books", "journal", "trial", "period"],
  donation: ["donation", "donor"],
  donor: ["donation"],
  charity: ["donation", "nonprofit"],
  goal: ["goal", "target", "progress"],
  target: ["goal", "progress"],
  incident: ["incident", "complaint", "report"],
  safety: ["incident", "certificate", "compliance"],
  compliance: ["compliance", "obligation", "certificate", "radar"],
  licence: ["certificate", "compliance", "obligation"],
  license: ["certificate", "compliance", "obligation"],
  insurance: ["obligation", "compliance", "asset"],
  timesheet: ["timesheet", "hours", "clock", "job"],
  hours: ["hours", "timesheet", "clock", "attendance"],
  clock: ["clock", "attendance", "timesheet"],
  subcontractor: ["subcontract", "handover", "supplier"],
  branch: ["branch", "compare"],
  currency: ["currency", "exchange", "foreign"],
  forex: ["currency", "exchange", "foreign"],
  duplicate: ["duplicate", "wrong", "match"],
  fraud: ["wrong", "duplicate", "anomaly", "audit"],
  marketing: ["broadcast", "enquiry", "review", "widget"],
  website: ["website", "widget", "enquiry"],
  lead: ["enquiry", "customer", "quote"],
  enquiry: ["enquiry", "customer", "lead"],
  report: ["report", "summary", "numbers", "pack"],
  summary: ["summary", "numbers", "snapshot", "pack"],
};

interface ToolDoc {
  name: string;
  /** Terms from the tool's own name — the strongest signal it has. */
  nameTerms: Set<string>;
  /** Terms from its description. */
  descTerms: Set<string>;
}

interface ToolIndex {
  docs: ToolDoc[];
  /** Inverse document frequency, so "list" counts for almost nothing. */
  idf: Map<string, number>;
}

/**
 * Split an identifier or a sentence into comparable terms.
 *
 * camelCase is split on case boundaries, so `whoOwesWhatToSuppliers` becomes
 * the same terms a person would type. Everything is lowercased, stopworded
 * and lightly stemmed — symmetrically on both sides, which is what matters
 * far more than the stemmer being good.
 */
export function terms(raw: string): string[] {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const out: string[] = [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    if (word.length < 2) continue;
    out.push(stem(word));
  }
  return out;
}

/**
 * A deliberately crude stemmer.
 *
 * It only has to make "invoices" and "invoice" the same token, and it is
 * applied to tool names and requests alike, so a mistake is at worst
 * consistent. A real stemmer would be a dependency and a tuning surface for
 * a gain nobody could measure here.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  // "es" only comes off after a sibilant — boxes, matches, expenses. Taking
  // it off everything turned "owes" into "ow", which then matched nothing in
  // the synonym table and cost us the whole "who owes us money" case.
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// The index is derived from tool names and descriptions, which are static
// strings — so it is built once per distinct tool set rather than per run.
const indexCache = new Map<string, ToolIndex>();

function buildIndex(tools: ToolSet): ToolIndex {
  const names = Object.keys(tools);
  const key = names.join("|");
  const cached = indexCache.get(key);
  if (cached) return cached;

  const docs: ToolDoc[] = names.map((name) => {
    const description = (tools[name] as { description?: string }).description ?? "";
    return {
      name,
      nameTerms: new Set(terms(name)),
      descTerms: new Set(terms(description)),
    };
  });

  const seenIn = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set([...doc.nameTerms, ...doc.descTerms])) {
      seenIn.set(term, (seenIn.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, count] of seenIn) {
    idf.set(term, Math.log(docs.length / count) + 1);
  }

  const index = { docs, idf };
  indexCache.set(key, index);
  return index;
}

/**
 * How much a synonym-derived term counts against one the person typed.
 *
 * A typed word is evidence; a synonym is a guess we made on their behalf.
 * Weighting them equally was measurably worse: expanding "owe" into four
 * near-synonyms gave a dozen tools a mid-ranking description hit each, and
 * those crowded `whoToChase` — the actual answer — out of the offered set.
 */
const SYNONYM_WEIGHT = 0.45;

interface QueryTerm {
  term: string;
  weight: number;
}

/**
 * The synonym table, keyed the way lookups actually arrive.
 *
 * The table above is written in whole words because that is how it stays
 * readable and extendable. Lookups happen after stemming, though, so a key
 * like "shedding" (which stems to "shedd") could never match what was typed
 * — the entry was dead on arrival and the miss was silent. Normalising the
 * keys through the same stemmer once, here, is what keeps the table written
 * in English and still correct.
 */
const STEMMED_SYNONYMS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [key, values] of Object.entries(SYNONYMS)) {
    const stemmedKey = stem(key);
    const merged = new Set([...(map.get(stemmedKey) ?? []), ...values.map(stem)]);
    map.set(stemmedKey, [...merged]);
  }
  return map;
})();

/** Query terms, plus whatever the synonym table says they also mean. */
function expand(text: string): QueryTerm[] {
  const typed = terms(text);
  const weights = new Map<string, number>();
  for (const term of typed) weights.set(term, 1);
  for (const term of typed) {
    for (const synonym of STEMMED_SYNONYMS.get(term) ?? []) {
      // Never let a synonym downgrade a word they actually typed.
      if (!weights.has(synonym)) weights.set(synonym, SYNONYM_WEIGHT);
    }
  }
  return [...weights].map(([term, weight]) => ({ term, weight }));
}

export interface ToolScore {
  name: string;
  score: number;
}

/**
 * Every tool, scored against this request, highest first.
 *
 * A hit in the tool's NAME counts for three times a hit in its description:
 * a tool called `overdueInvoices` is a better answer to "what's overdue" than
 * one that merely mentions overdue invoices in passing.
 */
export function scoreTools(tools: ToolSet, text: string): ToolScore[] {
  const { docs, idf } = buildIndex(tools);
  const queryTerms = expand(text);

  return docs
    .map((doc) => {
      let score = 0;
      for (const { term, weight } of queryTerms) {
        const rarity = (idf.get(term) ?? 0) * weight;
        if (doc.nameTerms.has(term)) score += rarity * 3;
        else if (doc.descTerms.has(term)) score += rarity;
      }
      return { name: doc.name, score };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export interface SelectionOptions {
  /** What the person asked. */
  text: string;
  /** Tools the caller knows are relevant — the page they are on, a recipe's declared set. */
  hints?: string[];
  /** Overrides MAX_TOOLS, for callers that know they need a wider net. */
  limit?: number;
}

/**
 * The names this run should be offered.
 *
 * Core first, then hints, then whatever scored above zero, up to the cap.
 * A request that matches nothing still gets the core set, which is the
 * difference between "I'm not sure what you mean" and "I can't do that".
 */
export function selectToolNames(tools: ToolSet, options: SelectionOptions): string[] {
  const available = new Set(Object.keys(tools));
  const limit = options.limit ?? MAX_TOOLS;
  const chosen: string[] = [];
  const add = (name: string) => {
    if (available.has(name) && !chosen.includes(name)) chosen.push(name);
  };

  for (const name of CORE_TOOLS) add(name);
  for (const name of options.hints ?? []) add(name);

  for (const { name, score } of scoreTools(tools, options.text)) {
    if (chosen.length >= limit) break;
    if (score <= 0) break;
    add(name);
  }

  return chosen;
}

export interface Selection {
  tools: ToolSet;
  /** For the run log: what was offered, and how much that saved. */
  offered: string[];
  availableCount: number;
}

/** The same tool set, narrowed to what this request could plausibly need. */
export function selectTools(tools: ToolSet, options: SelectionOptions): Selection {
  const offered = selectToolNames(tools, options);
  const narrowed: ToolSet = {};
  for (const name of offered) narrowed[name] = tools[name];
  return { tools: narrowed, offered, availableCount: Object.keys(tools).length };
}
