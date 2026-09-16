// "Call me back after the holidays."
//
// Most of what a customer says about timing is not a date. It is "next week",
// "after month end", "once the rains stop", "when we've got budget in July".
// Every one of those is a real commitment and none of them survives contact
// with a CRM that wants a date picker, so they end up in somebody's head and
// the quote dies four months later of nothing in particular.
//
// So: read the cue, turn it into a date, and say out loud what was assumed.
// The saying-out-loud is the whole thing. A system that silently decides
// "next week" means Tuesday the 14th will eventually be wrong in a way that
// costs somebody a job, and a system that shows its working is one somebody
// corrects in two seconds.
//
// Deliberately not a model. These are a few dozen phrases in two languages
// with a fixed meaning each, and a regular expression that can be read is
// better here than a model that is right more often and cannot be argued
// with — because the cost of a wrong answer is a customer who never hears
// back.

export interface Cue {
  /** What they actually wrote. */
  phrase: string;
  /** The date it resolves to. */
  when: Date;
  /** How sure, stated rather than implied. */
  confidence: "exact" | "likely" | "vague";
  /** What was assumed to get there, in plain words. */
  assumption: string;
}

const DAY = 86_400_000;

function at(from: Date, days: number): Date {
  const date = new Date(from.getTime() + days * DAY);
  // Nine in the morning: a reminder that fires at 3am is a reminder somebody
  // scrolls past before they are properly awake.
  date.setHours(9, 0, 0, 0);
  return date;
}

function nextMonthStart(from: Date): Date {
  const date = new Date(from.getFullYear(), from.getMonth() + 1, 1, 9, 0, 0, 0);
  return date;
}

function nextNamedMonth(from: Date, month: number): Date {
  const year = month > from.getMonth() ? from.getFullYear() : from.getFullYear() + 1;
  return new Date(year, month, 1, 9, 0, 0, 0);
}

const MONTHS: Array<[RegExp, number]> = [
  [/\bjan(uary)?\b/i, 0],
  [/\bfeb(ruary)?\b/i, 1],
  [/\bmar(ch)?\b/i, 2],
  [/\bapr(il)?\b/i, 3],
  [/\bmay\b/i, 4],
  [/\bjun(e)?\b/i, 5],
  [/\bjul(y)?\b/i, 6],
  [/\baug(ust)?\b/i, 7],
  [/\bsep(t|tember)?\b/i, 8],
  [/\boct(ober)?\b/i, 9],
  [/\bnov(ember)?\b/i, 10],
  [/\bdec(ember)?\b/i, 11],
];

/**
 * Read a scheduling cue out of what somebody wrote.
 *
 * Returns null rather than guessing when there is nothing there. A message
 * with no timing in it should produce no reminder, because a reminder nobody
 * asked for teaches people to ignore reminders.
 */
export function readCue(text: string, now = new Date()): Cue | null {
  const message = text.toLowerCase();

  // An actual date, written the way South Africans write them. Taken first,
  // because "call me on 14/03" should never be read as "next month".
  const written = message.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (written) {
    const day = Number(written[1]);
    const month = Number(written[2]) - 1;
    const year = written[3] ? (written[3].length === 2 ? 2000 + Number(written[3]) : Number(written[3])) : now.getFullYear();
    const date = new Date(year, month, day, 9, 0, 0, 0);
    if (!Number.isNaN(date.getTime()) && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return {
        phrase: written[0],
        when: date < now ? new Date(year + 1, month, day, 9, 0, 0, 0) : date,
        confidence: "exact",
        assumption: date < now ? "That date has passed this year, so it is read as next year." : "Read as a date, day first.",
      };
    }
  }

  const rules: Array<{ test: RegExp; days?: number; resolve?: (now: Date) => Date; confidence: Cue["confidence"]; assumption: string }> = [
    { test: /\btomorrow|môre\b/i, days: 1, confidence: "exact", assumption: "Tomorrow morning." },
    { test: /\bday after tomorrow\b/i, days: 2, confidence: "exact", assumption: "Two days from now." },
    { test: /\b(next|volgende) week\b/i, days: 7, confidence: "likely", assumption: "A week from now. Nobody says which day, so it is set for the same weekday." },
    { test: /\bin (a|1) week\b/i, days: 7, confidence: "likely", assumption: "A week from now." },
    { test: /\bin (2|two) weeks?\b/i, days: 14, confidence: "likely", assumption: "A fortnight from now." },
    { test: /\bin (3|three) weeks?\b/i, days: 21, confidence: "likely", assumption: "Three weeks from now." },
    { test: /\bin (a|1) month\b/i, days: 30, confidence: "likely", assumption: "About a month from now." },
    { test: /\bin (2|two) months?\b/i, days: 60, confidence: "vague", assumption: "About two months. Worth confirming nearer the time." },
    { test: /\bin (3|three) months?\b/i, days: 90, confidence: "vague", assumption: "About three months. Worth confirming nearer the time." },
    {
      test: /\b(next month|volgende maand)\b/i,
      resolve: nextMonthStart,
      confidence: "likely",
      assumption: "The first working day of next month, since no day was given.",
    },
    {
      test: /\b(month.?end|end of the month|after month.?end)\b/i,
      resolve: (from) => nextMonthStart(from),
      confidence: "likely",
      assumption: "Just after month end, which is when the money usually moves.",
    },
    {
      test: /\b(after the holidays|new year|in the new year|januarie)\b/i,
      resolve: (from) => new Date(from.getFullYear() + (from.getMonth() >= 11 ? 1 : 0), 0, 8, 9, 0, 0, 0),
      confidence: "vague",
      assumption: "The second week of January — the first is usually still quiet.",
    },
    {
      test: /\b(next (financial )?year|next fy)\b/i,
      resolve: (from) => new Date(from.getFullYear() + 1, 2, 1, 9, 0, 0, 0),
      confidence: "vague",
      assumption: "March, the start of the next tax year here.",
    },
    { test: /\b(when the rains? stop|after the rains?)\b/i, resolve: (from) => new Date(from.getFullYear() + (from.getMonth() >= 3 ? 1 : 0), 3, 1, 9, 0, 0, 0), confidence: "vague", assumption: "April, once the summer rain is done." },
    { test: /\b(quiet season|after season|off.?season)\b/i, days: 60, confidence: "vague", assumption: "About two months out. Nothing in the message says when the season ends." },
  ];

  for (const rule of rules) {
    const match = message.match(rule.test);
    if (!match) continue;
    return {
      phrase: match[0],
      when: rule.resolve ? rule.resolve(now) : at(now, rule.days ?? 7),
      confidence: rule.confidence,
      assumption: rule.assumption,
    };
  }

  // A named month on its own: "we'll do it in July".
  for (const [pattern, month] of MONTHS) {
    const match = message.match(pattern);
    if (!match) continue;
    return {
      phrase: match[0],
      when: nextNamedMonth(now, month),
      confidence: "vague",
      assumption: "The first of that month, since no day was given. The next one — this year if it has not passed, otherwise next.",
    };
  }

  return null;
}

export interface Proposal {
  cue: Cue;
  /** What to say back, ready to send. */
  reply: string;
  /** What will happen if nobody does anything. */
  thenWhat: string;
}

/**
 * Turn a cue into something to say back.
 *
 * A vague cue gets a question; an exact one gets a confirmation. That
 * distinction matters more than it looks: asking somebody to confirm a date
 * they already gave is irritating, and silently accepting "sometime next
 * year" is how a quote dies.
 */
export function propose(cue: Cue, params: { businessName: string; what?: string }): Proposal {
  const when = cue.when.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
  const thing = params.what ?? "this";

  if (cue.confidence === "exact") {
    return {
      cue,
      reply: `Noted — I have put ${thing} down for ${when}. I will be in touch then.`,
      thenWhat: `A reminder on ${when}. Nothing else happens in between.`,
    };
  }

  if (cue.confidence === "likely") {
    return {
      cue,
      reply: `No problem. I have pencilled in ${when} — shout if another day suits you better.`,
      thenWhat: `A reminder on ${when}, which you can move.`,
    };
  }

  return {
    cue,
    reply: `Understood. Shall I come back to you around ${when}, or would you rather tell me when the time is right?`,
    thenWhat: `A reminder on ${when} unless they say otherwise. ${cue.assumption}`,
  };
}

/**
 * The whole thing, from a message to a reminder.
 *
 * Returns what it would do rather than doing it: the caller decides whether
 * to set the reminder, because a quote that silently reschedules itself off
 * something a customer half-said is a quote nobody is watching.
 */
export function readAndPropose(params: { text: string; businessName: string; what?: string; now?: Date }): Proposal | null {
  const cue = readCue(params.text, params.now);
  if (!cue) return null;
  return propose(cue, { businessName: params.businessName, what: params.what });
}
