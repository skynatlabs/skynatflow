// The legal pages, as content rather than markup.
//
// ⚠ DRAFTED, NOT ADVISED. These are written to describe what this product
// actually does — the retention rules come from core/dataProtection.ts, the
// deletion flow from core/accountClosure.ts, the export from
// core/portability.ts — so they are accurate about the software. They have
// NOT been reviewed by a lawyer, and they must be before this business
// relies on them or takes money against them. Two things in particular need
// a professional eye: the limitation of liability, and whether the POPIA
// operator / GDPR processor characterisation below matches how the business
// is actually structured.
//
// Kept here rather than in a CMS so that a change to what the software does
// and a change to what we say about it land in the same commit.

export interface Clause {
  heading: string;
  body: string[];
}

export const LAST_UPDATED = "21 September 2026";

export const TERMS: Clause[] = [
  {
    heading: "Who this agreement is between",
    body: [
      "These terms are between Skynat Labs, which operates flow at skynatflow.com, and the business that opens a workspace. Where the terms say \"you\", they mean that business, not the individual person who signed up — a workspace belongs to the business, and the people with logins act on its behalf.",
    ],
  },
  {
    heading: "What the service is",
    body: [
      "flow keeps a business's records: quotes, invoices, payments, customers, stock, jobs, and a general ledger. It also includes an AI assistant that can read those records and, where the business allows it, act on them.",
      "The assistant proposes and acts within limits the business sets. Anything that moves money or sends a message to a customer stops for a person to approve, at every autonomy setting, and that is not configurable.",
    ],
  },
  {
    heading: "Your records are yours",
    body: [
      "You own what you put in. We hold it to run the service for you and do not use one business's customer data for the benefit of another.",
      "Aggregated comparisons — how your margin compares to similar businesses — are opt-in, off by default, and never report a figure that could identify a single business. You can turn them off at any time.",
    ],
  },
  {
    heading: "What you are responsible for",
    body: [
      "Keeping your logins secure, and telling us promptly if one is compromised. Two-factor authentication is available and we recommend it.",
      "The accuracy of what you record. The service computes totals, tax and reports from what it is given; it cannot know that a figure was typed wrongly.",
      "Checking anything the assistant drafts before it goes to a customer. A draft is a draft.",
    ],
  },
  {
    heading: "Payment",
    body: [
      "Plans are charged monthly in advance, per seat, and seats are counted rather than rounded up into blocks. Customers, suppliers and your accountant use the portal free and are not seats.",
      "If a payment fails we will tell you and try again. We do not lock a business out of its own records for a failed payment — access to read and export what is yours continues.",
    ],
  },
  {
    heading: "Ending it",
    body: [
      "You can close your account at any time from your settings. Closing offers you a complete copy of your records first — every table, as JSON and CSV — and there is a grace period before anything is removed.",
      "Some records are kept after closure because the law requires it: invoices and tax records for as long as the tax authority where you trade requires, which is five years for SARS and longer in some countries. We will tell you exactly which parts were kept and why.",
    ],
  },
  {
    heading: "Availability",
    body: [
      "We aim for the service to be available at all times and publish its current state at /status. We do not yet offer a contractual uptime guarantee with service credits; when we do, it will be written here rather than assumed.",
    ],
  },
  {
    heading: "Liability",
    body: [
      "Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot lawfully be limited.",
      "Otherwise, our total liability in any twelve-month period is limited to what you paid us in that period. We are not liable for lost profits or lost business.",
      "⚠ This clause in particular has not been reviewed by a lawyer and must be before it is relied on.",
    ],
  },
  {
    heading: "Changes",
    body: [
      "If we change these terms in a way that materially affects you, we will tell you before the change takes effect and you may close your account if you do not accept it.",
    ],
  },
];

export const PRIVACY: Clause[] = [
  {
    heading: "Two different roles",
    body: [
      "For information about the business using flow — the account, its staff, what it pays us — Skynat Labs is the responsible party under POPIA and the controller under the GDPR.",
      "For information a business records about its own customers, the business is the responsible party or controller, and we are its operator under POPIA and its processor under the GDPR. We act on that business's instructions and do not use its customer data for anything else.",
    ],
  },
  {
    heading: "What we hold, and why",
    body: [
      "Account information: the name and email of each person with a login, so they can sign in and be attributed for what they do.",
      "Business records: whatever the business chooses to record — customers, documents, money, stock, jobs.",
      "Operational records: sign-in attempts, an audit trail of who changed what, server errors with names and identifiers stripped out, and timing samples that carry no content at all. These exist so we can tell a business what happened on its account and so that a fault is visible before a customer has to report it.",
    ],
  },
  {
    heading: "The AI assistant",
    body: [
      "When the assistant is used, the relevant part of the workspace's own records is sent to a model provider to produce an answer. Which provider can be chosen per workspace in settings.",
      "What is sent is what the question needs, not the whole workspace. We do not use a business's records to train a model, and we do not permit our providers to.",
    ],
  },
  {
    heading: "Who else sees it",
    body: [
      "Sub-processors, and only for the job they do: hosting, the database, email delivery, file storage, payment processing, and the model provider in use. Each is bound to the same obligations we owe you.",
      "Nobody else. We do not sell personal information and we do not share it for anyone else's marketing.",
    ],
  },
  {
    heading: "Where it is kept",
    body: [
      "Currently in a single region. If you need your records kept in a specific jurisdiction, ask before signing up — we would rather say no than say yes and be wrong.",
    ],
  },
  {
    heading: "How long",
    body: [
      "For as long as the workspace is open. After closure, most of it is removed after a grace period. Invoices and tax records are kept for the period the law where you trade requires, because both POPIA and the GDPR allow keeping what a law requires and the tax authority requires these.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "You can ask what we hold about you, ask for it to be corrected, ask for a copy, and ask for it to be deleted. Deletion is not absolute — what the law requires kept stays, and you are entitled to be told exactly which parts and why.",
      "A business using flow can answer most of these for its own customers from inside the product, which is where such a request usually belongs.",
      "If you are unhappy with how we have handled a request, you can complain to the Information Regulator in South Africa or to your own supervisory authority.",
    ],
  },
  {
    heading: "Security",
    body: [
      "Access to a workspace is checked on every request against a real membership, not against the address in the browser. Passwords are hashed, credentials stored in the database are encrypted, and sign-in is throttled against guessing.",
      "We hold no independent security certification yet. SOC 2 is in progress and this paragraph will say so plainly until it is finished.",
    ],
  },
];
