// When a named agent is due to run.
//
// AgentDefinition.schedule has held a cron expression since the day named
// agents shipped, and the console printed it back to the owner — but nothing
// ever evaluated it. An agent set to "0 9 * * 1-5" ran only when somebody
// clicked Run now, while the UI said it ran every weekday morning. This is
// the missing half.
//
// No new dependency: a cron matcher is about sixty lines, and the ones on npm
// bring a scheduler daemon we don't want. The tick is the scheduler.
//
// Time zone matters more here than it looks. Cron is evaluated against the
// business's local clock, not the server's — a South African owner writing
// "6am" means 6am in Johannesburg, and a Vercel function runs in UTC, so
// evaluating naively would fire the morning brief at 8am. Intl does the
// conversion, including DST, without a library.

export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE ?? "Africa/Johannesburg";

/**
 * How far back to look for a missed firing when an agent has never run.
 *
 * A newly created agent must not fire the instant it is saved just because
 * its 6am slot already passed today, so the window for a never-run agent is
 * one tick's worth of time rather than all of history.
 */
const FIRST_RUN_LOOKBACK_MS = 65 * 60 * 1000;

/**
 * Ceiling on the catch-up window. An agent whose workspace was quiet for a
 * week should fire once when the ticks resume, not once for every slot it
 * missed — nobody wants sixty backdated morning briefs.
 */
const MAX_LOOKBACK_MS = 26 * 60 * 60 * 1000;

type FieldSet = Set<number> | null; // null means "*"

interface CronFields {
  minute: FieldSet;
  hour: FieldSet;
  dayOfMonth: FieldSet;
  month: FieldSet;
  dayOfWeek: FieldSet;
}

const BOUNDS = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7], // 7 and 0 are both Sunday
} as const;

function parseField(raw: string, [min, max]: readonly [number, number]): FieldSet {
  const field = raw.trim();
  if (field === "*") return null;

  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in "${part}"`);

    let from: number;
    let to: number;

    if (rangePart === "*") {
      from = min;
      to = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Bad range in "${part}"`);
      from = a;
      to = b;
    } else {
      const n = Number(rangePart);
      if (!Number.isInteger(n)) throw new Error(`Bad value "${part}"`);
      from = n;
      // A bare number with a step ("5/10") means "from 5 to the end", which is
      // what crontab does; a bare number alone is just itself.
      to = stepPart === undefined ? n : max;
    }

    if (from < min || to > max || from > to) throw new Error(`"${part}" is outside ${min}-${max}`);
    for (let v = from; v <= to; v += step) values.add(v);
  }

  if (values.size === 0) throw new Error(`"${field}" matches nothing`);
  return values;
}

export function parseCron(expr: string): CronFields {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("A schedule needs five fields: minute hour day-of-month month day-of-week.");
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    minute: parseField(minute, BOUNDS.minute),
    hour: parseField(hour, BOUNDS.hour),
    dayOfMonth: parseField(dayOfMonth, BOUNDS.dayOfMonth),
    month: parseField(month, BOUNDS.month),
    dayOfWeek: parseField(dayOfWeek, BOUNDS.dayOfWeek),
  };
}

/** True when `expr` is something parseCron accepts. */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

// Constructing an Intl.DateTimeFormat is expensive — enough that building one
// per call made a sweep over a day of ticks take seconds rather than
// milliseconds. There is one formatter per zone and a process sees one or two,
// so this is a small map that never meaningfully grows.
const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = ZONE_FORMATTERS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hourCycle: "h23",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    ZONE_FORMATTERS.set(timeZone, fmt);
  }
  return fmt;
}

/** Wall-clock fields for an instant, as read in a given time zone. */
function fieldsInZone(date: Date, timeZone: string) {
  const parts = zoneFormatter(timeZone).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    minute: Number(get("minute")),
    hour: Number(get("hour")),
    dayOfMonth: Number(get("day")),
    month: Number(get("month")),
    dayOfWeek: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

function inSet(set: FieldSet, value: number, sundayAlias = false): boolean {
  if (set === null) return true;
  if (set.has(value)) return true;
  // Cron accepts 7 for Sunday as well as 0.
  return sundayAlias && value === 0 && set.has(7);
}

/** Does this instant fall on a minute the expression names? */
export function matchesCron(expr: string, at: Date, timeZone = DEFAULT_TIMEZONE): boolean {
  let cron: CronFields;
  try {
    cron = parseCron(expr);
  } catch {
    return false;
  }

  const f = fieldsInZone(at, timeZone);

  if (!inSet(cron.minute, f.minute)) return false;
  if (!inSet(cron.hour, f.hour)) return false;
  if (!inSet(cron.month, f.month)) return false;

  // Standard crontab quirk, and a real one: when BOTH day-of-month and
  // day-of-week are restricted, the day matches if either does — not both.
  // "0 0 1 * 1" is the first of the month OR any Monday.
  const domRestricted = cron.dayOfMonth !== null;
  const dowRestricted = cron.dayOfWeek !== null;
  const domHit = inSet(cron.dayOfMonth, f.dayOfMonth);
  const dowHit = inSet(cron.dayOfWeek, f.dayOfWeek, true);

  if (domRestricted && dowRestricted) return domHit || dowHit;
  return domHit && dowHit;
}

/**
 * Should this agent run on this tick?
 *
 * The tick runs every half hour, so "does now match the expression" would
 * miss almost every schedule. Instead this asks whether any minute since the
 * last run was a scheduled one — which fires exactly once per slot regardless
 * of how the tick interval and the schedule line up.
 */
export function isDue(params: {
  expr: string | null | undefined;
  lastRunAt: Date | null;
  now?: Date;
  timeZone?: string;
}): boolean {
  const { expr, lastRunAt, now = new Date(), timeZone = DEFAULT_TIMEZONE } = params;
  if (!expr || !expr.trim()) return false;
  if (!isValidCron(expr)) return false;

  const nowMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  const earliest = nowMinute - MAX_LOOKBACK_MS;

  let cursor = lastRunAt
    ? Math.floor(lastRunAt.getTime() / 60_000) * 60_000 + 60_000
    : nowMinute - FIRST_RUN_LOOKBACK_MS;

  if (cursor < earliest) cursor = earliest;
  if (cursor > nowMinute) return false;

  for (let t = cursor; t <= nowMinute; t += 60_000) {
    if (matchesCron(expr, new Date(t), timeZone)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- describing

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Plain English for the console.
 *
 * A business owner should never have to read "0 9 * * 1-5" to find out when
 * their collections agent runs. Falls back to the raw expression only for
 * shapes too unusual to phrase, which is better than phrasing them wrongly.
 */
export function describeCron(expr: string | null | undefined): string {
  if (!expr || !expr.trim()) return "Runs when you ask";

  let cron: CronFields;
  try {
    cron = parseCron(expr);
  } catch {
    return "Schedule not understood";
  }

  const time = describeTime(cron);
  const days = describeDays(cron);
  if (!time || !days) return `Runs on ${expr}`;
  return `${days} ${time}`.replace(/\s+/g, " ").trim();
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function describeTime(cron: CronFields): string | null {
  const { minute, hour } = cron;

  if (minute !== null && minute.size === 1 && hour !== null && hour.size === 1) {
    return `at ${pad([...hour][0])}:${pad([...minute][0])}`;
  }
  if (minute !== null && minute.size === 1 && hour === null) {
    const m = [...minute][0];
    return m === 0 ? "on the hour, every hour" : `at ${pad(m)} past every hour`;
  }
  if (minute !== null && minute.size > 1 && hour === null) {
    const sorted = [...minute].sort((a, b) => a - b);
    const gap = sorted.length > 1 ? sorted[1] - sorted[0] : 0;
    const even = gap > 0 && sorted.every((v, i) => i === 0 || v - sorted[i - 1] === gap);
    if (even && 60 % gap === 0 && sorted[0] === 0) return `every ${gap} minutes`;
  }
  if (minute === null) return "every minute";
  return null;
}

function describeDays(cron: CronFields): string | null {
  const { dayOfMonth, dayOfWeek, month } = cron;
  if (month !== null) return null; // month-specific schedules are rare; don't guess

  if (dayOfWeek === null && dayOfMonth === null) return "Every day";

  if (dayOfWeek !== null && dayOfMonth === null) {
    const days = [...dayOfWeek].map((d) => (d === 7 ? 0 : d)).sort((a, b) => a - b);
    const unique = [...new Set(days)];
    const key = unique.join(",");
    if (key === "1,2,3,4,5") return "Weekdays";
    if (key === "0,6") return "Weekends";
    if (key === "0,1,2,3,4,5,6") return "Every day";
    if (unique.length === 1) return `Every ${DAY_NAMES[unique[0]]}`;
    return `Every ${unique.map((d) => DAY_NAMES[d]).join(", ")}`;
  }

  if (dayOfMonth !== null && dayOfWeek === null) {
    const dates = [...dayOfMonth].sort((a, b) => a - b);
    if (dates.length === 1) return `On the ${ordinal(dates[0])} of each month`;
    return `On the ${dates.map(ordinal).join(", ")} of each month`;
  }

  return null;
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}
