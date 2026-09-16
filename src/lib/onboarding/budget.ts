// Three minutes, and a test that keeps it three minutes.
//
// "Set up in three minutes" is a promise that rots the way every other claim
// in this codebase rots: somebody adds a field, then a step, then a required
// upload, and eighteen months later setup takes a quarter of an hour and
// nobody can point at the commit that did it.
//
// So the budget is written down, in seconds, per field. Anything a person has
// to read, decide or type has a cost. The sum is checked by a test, and a
// change that pushes setup past the promise fails that test rather than
// failing a customer at eleven at night.
//
// The numbers are not guesses about a fast typist. They are what somebody
// does on a phone, on a building site, with a child asking them something.

import { STEPS, type StepKey } from "./progress";

export interface FieldCost {
  /** What the person is being asked for. */
  field: string;
  /** Seconds, honestly. */
  seconds: number;
  /** Whether setup can finish without it. */
  required: boolean;
  /** Why it costs what it costs, where that is not obvious. */
  note?: string;
}

/**
 * Typing something short — a name, a phone number.
 * On a phone keyboard, with a typo and a correction.
 */
const TYPE_SHORT = 12;
/** A longer one: an address, an email. */
const TYPE_LONG = 20;
/** Picking from a list that is already on screen. */
const CHOOSE = 6;
/** A decision that needs a moment's thought before the tap. */
const DECIDE = 15;
/** Finding a file on a phone and waiting for it to go up. */
const UPLOAD = 35;

export const SETUP_BUDGET: Record<StepKey, FieldCost[]> = {
  business: [
    { field: "Business name", seconds: TYPE_SHORT, required: true },
    { field: "Trade", seconds: CHOOSE, required: true, note: "A list, not a text box — and it sets the accounts and the starter catalogue behind the scenes." },
    { field: "Country", seconds: CHOOSE, required: true, note: "Decides the tax rules, so it cannot be skipped." },
    { field: "Your phone number", seconds: TYPE_SHORT, required: false },
  ],
  details: [
    { field: "Website address", seconds: TYPE_SHORT, required: false, note: "Optional, and it pays for itself — the rest of this step fills itself in from it." },
    { field: "Business email", seconds: TYPE_LONG, required: false },
    { field: "Address", seconds: TYPE_LONG, required: false },
    { field: "VAT number", seconds: TYPE_SHORT, required: false, note: "Only asked of a business that says it is registered." },
  ],
  stock: [
    { field: "What you sell", seconds: DECIDE, required: false, note: "The trade's starter catalogue is already there, so this is a glance rather than a form." },
  ],
  customers: [
    { field: "Customers", seconds: DECIDE, required: false, note: "A file if they have one, nothing if they do not. Customers arrive on their own as work happens." },
  ],
  look: [
    { field: "Logo", seconds: UPLOAD, required: false, note: "Skippable, and skipped by most people on the first day." },
  ],
};

/** The promise, in seconds. */
export const PROMISE_SECONDS = 180;

export interface BudgetReport {
  /** What it costs somebody who fills in only what they must. */
  requiredSeconds: number;
  /** What it costs somebody who fills in everything. */
  thoroughSeconds: number;
  withinPromise: boolean;
  steps: Array<{ key: StepKey; label: string; requiredSeconds: number; thoroughSeconds: number; fields: FieldCost[] }>;
  /** What to cut first if this ever goes over. */
  mostExpensiveOptional: FieldCost | null;
}

export function setupBudget(): BudgetReport {
  const steps = STEPS.map((step) => {
    const fields = SETUP_BUDGET[step.key] ?? [];
    return {
      key: step.key,
      label: step.label,
      requiredSeconds: fields.filter((field) => field.required).reduce((sum, field) => sum + field.seconds, 0),
      thoroughSeconds: fields.reduce((sum, field) => sum + field.seconds, 0),
      fields,
    };
  });

  const requiredSeconds = steps.reduce((sum, step) => sum + step.requiredSeconds, 0);
  const thoroughSeconds = steps.reduce((sum, step) => sum + step.thoroughSeconds, 0);

  const optional = Object.values(SETUP_BUDGET)
    .flat()
    .filter((field) => !field.required)
    .sort((a, b) => b.seconds - a.seconds);

  return {
    requiredSeconds,
    thoroughSeconds,
    // The promise is about the path somebody actually takes, which is the
    // required one — every optional field is a thing they chose to do.
    withinPromise: requiredSeconds <= PROMISE_SECONDS,
    steps,
    mostExpensiveOptional: optional[0] ?? null,
  };
}

/** The sentence for the setup screen, so the claim is visible and checkable. */
export function budgetSentence(): string {
  const report = setupBudget();
  const minutes = Math.ceil(report.requiredSeconds / 60);
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} to the point where you can send your first quote. Everything else can wait, and most of it fills itself in.`;
}
