// What the agent is allowed to do without asking.
//
// This is the piece that makes autonomy sellable to a business owner rather
// than frightening. Three dials, and one rule that no dial can override:
// money movement and outbound customer contact always stop for a human.
//
// The gate is enforced in the runtime, not the prompt. A model that decides
// to send an invoice anyway still has its tool call intercepted, because the
// decision about whether a tool may auto-run is made in code from the tenant's
// setting and the tool's classification — never from what the model asserts.

import type { AgentAutonomy } from "@prisma/client";

/**
 * IRREVERSIBLE — always requires a human, at every autonomy level.
 * These either move money or say something to a customer in the business's
 * name. Both are things you cannot take back with an undo button.
 */
const ALWAYS_ASK = new Set([
  "recordPayment",
  "recordRefund",
  "sendQuote",
  "convertQuoteToInvoice",
  // A message from the business's own mailbox is the business speaking.
  "sendMailMessage",
  // A contract the customer can sign the moment it lands. Nothing in this app
  // binds the business to more than this does.
  "sendAgreementForSignature",
  // Money taken at a counter, posted to the books and the stock in one step.
  "recordCashSale",
  // Emails a stranger an invitation and gives them a view of the business.
  "addSomebodyToTheTeam",
  // Money leaving the account, and the books saying so.
  "paySupplierBill",
  // Assembles every approved bill due into one batch. Nothing has gone yet,
  // but a run built wrong is a run somebody releases without re-reading.
  "buildPaymentRun",
  // Says out loud to a customer that they are late. The wording matters and
  // a business should see it before its name is on it.
  "recordTheChase",
  // Assembles a message to a whole customer list. Nothing is sent by it, but
  // the skipped list is the thing a person has to read before anything is,
  // and a draft nobody looked at is one release away from a lost number.
  "planABroadcast",
]);

/**
 * REVERSIBLE — creates or edits internal state that a person can undo by
 * hand in seconds. Safe to auto-run once the owner has opted past
 * SUGGEST_ONLY.
 */
const REVERSIBLE = new Set([
  "createQuote", // a DRAFT quote; nothing has left the building
  "createCustomer",
  "updateCustomerDetails",
  "createTask",
  "updateTaskStatus",
  "scheduleAppointment",
  // The agent's own notes about the workspace. No money, no customer contact,
  // and the owner can read and delete every one of them in the console — but
  // it is still a write, so a workspace set to "nothing runs on its own"
  // holds it like everything else rather than quietly making an exception.
  "rememberFact",
  "forgetFact",
  // Composes a DRAFT quote from pasted text. Same standing as createQuote:
  // it may add a customer and a catalog item along the way, but nothing has
  // left the building and every part of it is editable.
  "draftQuoteFromText",
]);

export type ActionVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Read-only tools are always allowed; looking never needs permission. */
export function isReadOnly(toolName: string): boolean {
  return !ALWAYS_ASK.has(toolName) && !REVERSIBLE.has(toolName);
}

/**
 * May this tool run unattended, for a workspace at this autonomy level?
 *
 * `trigger` matters: a user typing "send that quote" is present and has just
 * asked, so an irreversible action is their decision to make. The same action
 * chosen by the scheduled tick, with nobody watching, is not.
 */
export function canAutoRun(params: {
  toolName: string;
  autonomy: AgentAutonomy;
  userPresent: boolean;
  /**
   * Whether this tool writes anything, as the caller already knows from
   * MUTATING_TOOLS. Without it the only signal is the two lists below, and a
   * write tool added to the registry and not added to a list would read as
   * read-only and run itself in a workspace set to "nothing runs on its own".
   * The registry is the authority; the lists only say how careful to be.
   */
  isMutation?: boolean;
}): ActionVerdict {
  const { toolName, autonomy, userPresent, isMutation } = params;

  if (!isMutation && isReadOnly(toolName)) return { allowed: true };

  if (ALWAYS_ASK.has(toolName)) {
    if (userPresent) return { allowed: true };
    return {
      allowed: false,
      reason:
        "This moves money or contacts a customer, so it waits for someone to approve it.",
    };
  }

  // Reversible from here down.
  switch (autonomy) {
    case "SUGGEST_ONLY":
      return {
        allowed: false,
        reason: "This workspace has the agent set to suggest only — nothing runs on its own.",
      };
    case "REVERSIBLE":
    case "FULL":
      return { allowed: true };
    default:
      return { allowed: false, reason: "Unknown autonomy setting." };
  }
}

export const AUTONOMY_LABELS: Record<AgentAutonomy, string> = {
  SUGGEST_ONLY: "Suggest only — I approve everything",
  REVERSIBLE: "Do the reversible things, ask about the rest",
  FULL: "Run freely, but always ask before money or customer contact",
};

export const AUTONOMY_DESCRIPTIONS: Record<AgentAutonomy, string> = {
  SUGGEST_ONLY:
    "The agent still watches the business and tells you what it would do, but never changes anything itself.",
  REVERSIBLE:
    "Drafts, tasks, bookings and contact edits happen automatically. Sending anything to a customer, or touching money, still waits for you.",
  FULL:
    "The agent runs its own work end to end. Recording payments and sending documents to customers still stop for approval — that never changes.",
};
