// Tool names, said out loud.
//
// The agent's progress is only reassuring if it reads like work: "Checking
// who owes us money" tells an owner something, `findStaleDocuments` tells
// them the software is talking to itself. Shared by the server (which streams
// these) and the client (which renders held actions), so one action is never
// described two different ways in two places.

/** Actions worth naming exactly, mostly the ones that stop for approval. */
const EXACT: Record<string, string> = {
  recordPayment: "Record a payment",
  recordRefund: "Issue a refund",
  sendQuote: "Send a quote to the customer",
  convertQuoteToInvoice: "Turn a quote into an invoice",
  applyLateFee: "Apply a late fee",
  createQuote: "Create a draft quote",
  createCustomer: "Add a customer",
  updateCustomerDetails: "Update customer details",
  scheduleAppointment: "Book an appointment",
  createTask: "Create a task",
  rememberFact: "Remember something about the business",
  forgetFact: "Forget something it had remembered",
  recallFacts: "Check what it already knows",
  businessSnapshot: "Look at the headline numbers",
  findStaleDocuments: "Look for things that have gone quiet",
  customerHistory: "Read the customer's history",
  customerBalance: "Check what the customer owes",
  findCustomers: "Look up customers",
  listProducts: "Look through the catalog",
  awaitingSignature: "Check what is waiting to be signed",
  signingRecord: "Open the signing record",
  bookkeeperExport: "Prepare the books for the accountant",
  documentCopies: "Check where document copies go",
  websiteWidgets: "Look at the forms for the website",
  brandingSettings: "Check what customers see",
  setBranding: "Change the logo and colour customers see",
  chooseDocumentDrive: "Choose where copies of documents go",
};

/**
 * Prefixes that carry the verb. Anything not listed falls back to "Check",
 * which is true of every read tool and harmless for the rest.
 */
const VERBS: [string, string][] = [
  ["findItemByBarcode", "Look up"],
  ["list", "Look through"],
  ["find", "Look for"],
  ["search", "Search"],
  ["get", "Check"],
  ["create", "Create"],
  ["update", "Update"],
  ["set", "Update"],
  ["record", "Record"],
  ["send", "Send"],
  ["convert", "Convert"],
  ["mark", "Mark"],
  ["add", "Add"],
  ["log", "Log"],
  ["open", "Open"],
  ["close", "Close"],
  ["apply", "Apply"],
  ["schedule", "Schedule"],
  ["submit", "Submit"],
  ["approve", "Approve"],
  ["reject", "Turn down"],
  ["complete", "Complete"],
  ["return", "Book in"],
  ["read", "Read"],
  ["check", "Check"],
];

function words(rest: string): string {
  return rest
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
}

/** "findStaleDocuments" → "Look for stale documents". */
export function toolLabel(tool: string): string {
  if (EXACT[tool]) return EXACT[tool];

  for (const [prefix, verb] of VERBS) {
    if (tool.startsWith(prefix) && tool.length > prefix.length) {
      return `${verb} ${words(tool.slice(prefix.length))}`;
    }
  }

  // No recognised verb: title-case the name and let it speak for itself,
  // which still beats showing raw camelCase.
  const plain = words(tool);
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** The same thing phrased as work in progress: "Looking for stale documents". */
export function toolLabelProgressive(tool: string): string {
  const label = toolLabel(tool);
  const [first, ...rest] = label.split(" ");
  const ing = PROGRESSIVE[first] ?? PROGRESSIVE[first.toLowerCase()];
  if (!ing) return label;
  return [ing, ...rest].join(" ");
}

const PROGRESSIVE: Record<string, string> = {
  Look: "Looking",
  Search: "Searching",
  Check: "Checking",
  Create: "Creating",
  Update: "Updating",
  Record: "Recording",
  Send: "Sending",
  Convert: "Converting",
  Mark: "Marking",
  Add: "Adding",
  Log: "Logging",
  Open: "Opening",
  Close: "Closing",
  Apply: "Applying",
  Schedule: "Scheduling",
  Submit: "Submitting",
  Approve: "Approving",
  Turn: "Turning",
  Complete: "Completing",
  Book: "Booking",
  Read: "Reading",
  Remember: "Noting",
  Forget: "Forgetting",
  Issue: "Issuing",
};
