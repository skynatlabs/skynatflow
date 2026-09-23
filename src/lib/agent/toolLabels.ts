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
  pickList: "Work out the picking walk",
  warehouseLayout: "Look at the warehouse bins",
  counterfeitPicture: "Check where fakes are turning up",
  saveWarehouseBin: "Add or change a warehouse bin",
  moveStockInWarehouse: "Move stock between bins",
  countWarehouseBin: "Count a bin",
  issueProductCodes: "Create authentication codes",
  checkProductCode: "Check whether a product is genuine",
  withdrawProductCode: "Withdraw an authentication code",
  whatOthersPay: "Compare what you pay against others",
  checkBillsBeforePaying: "Check the bills before they are paid",
  duplicateSuppliers: "Look for duplicate suppliers",
  setSupplierBankDetails: "Change where a supplier gets paid",
  deliveryMoney: "Check the cash out on delivery",
  buyerReliability: "Check who actually takes their deliveries",
  openRiderBag: "Open a rider's cash bag",
  handParcelToRider: "Hand a parcel to a rider",
  recordDeliveryAttempt: "Record a delivery attempt",
  closeRiderBag: "Count a rider's bag back in",
  rosterStatus: "Check the roster",
  signOnsToCheck: "Look at sign-ons that need checking",
  workSitesAndShifts: "Look at sites and shifts",
  casualLabour: "Check casual labour and what is owed",
  saveWorkSite: "Add or change a work site",
  rosterShift: "Put a shift on the roster",
  saveCasualWorker: "Add or update a casual worker",
  logCasualWork: "Log a day of casual work",
  approveCasualWork: "Approve casual work for payment",
  markCasualWorkPaid: "Mark casual work as paid",
  callsToday: "Work out today's shop calls",
  outletCoverage: "Check how the field team is doing",
  distributionPicture: "Look at what moved past the warehouse",
  rangeGaps: "Find shops missing a line they should carry",
  listOutlets: "Look at the trade map",
  mapOutlet: "Put a shop on the trade map",
  saveSalesRoute: "Set up a journey plan",
  recordOutletArrival: "Record arriving at a shop",
  recordOutletOutcome: "Record what happened at a shop",
  menuCosts: "Work out what the dishes cost to make",
  setDishRecipe: "Set what a dish is made of",
  removeDishRecipe: "Remove a dish's recipe",
  creditBook: "Look at who owes money on credit",
  creditBookCustomer: "Read a customer's credit page",
  recordCreditEntry: "Write a credit entry into the book",
  recordCreditRepayment: "Record a payment off a credit account",
  rewardsMembers: "Look at the rewards programme",
  rewardsHistory: "Read a member's points history",
  joinRewards: "Sign a customer up to rewards",
  redeemRewardPoints: "Spend a customer's reward points",
  adjustRewardPoints: "Adjust reward points by hand",
  setUpRewards: "Change the rewards programme",
  awaitingSignature: "Check what is waiting to be signed",
  signingRecord: "Open the signing record",
  bookkeeperExport: "Prepare the books for the accountant",
  documentCopies: "Check where document copies go",
  websiteWidgets: "Look at the forms for the website",
  brandingSettings: "Check what customers see",
  setBranding: "Change the logo and colour customers see",
  chooseDocumentDrive: "Choose where copies of documents go",
  payrollForecast: "Work out what payroll costs",
  vatFilingPack: "Put the VAT return together",
  powerSchedule: "Check when the power is off",
  setPowerSchedule: "Record when the power is off",
  marketplaceMargin: "Work out what is left after the marketplace",
  parcelAdvice: "Work out what the parcel will cost to send",
  buildCollectionManifest: "Make the courier's collection sheet",
  whoAreThey: "Check who this customer really is",
  allowanceUsed: "Check what has been used this month",
  readTheirWebsite: "Read their website",
  applyIndustryPack: "Set the workspace up for this trade",
  dataProtectionRecord: "Check what the business holds about people",
  whatWeHoldAbout: "Check what is held about one person",
  heldTooLong: "Look for anything held too long",
  tradingConnections: "Check the trading connections",
  listInTradingGraph: "Change whether the business can be matched",
  todaysWorkInTheField: "Check the day out on site",
  notificationsOnPhones: "Check who gets told on their phone",
  proofForJob: "Check what proves the job was done",
  jobsWithoutProof: "Look for jobs nobody can defend",
  weeklyTimesheet: "Look at the week's hours",
  subcontractedWork: "Check what was put out to subcontractors",
  whatWaitsOnWhat: "Work out what waits on what",
  handOverToSubcontractor: "Hand a job to a subcontractor",
  makeJobWaitFor: "Make one job wait for another",
  thingsThatLookWrong: "Look for anything that looks wrong",
  whoToAskForAReview: "Check who to ask for a review",
  draftReviewReply: "Draft a reply to a review",
  readTheTimingTheyGave: "Work out when they meant",
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
