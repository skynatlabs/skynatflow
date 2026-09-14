// Scheduling bugs in an agent are not cosmetic: a double-fire means a customer
// gets chased twice, and a missed fire means the owner believes work happened
// that didn't. These tests pin both directions.

import { describe, it, expect } from "vitest";
import {
  matchesCron,
  isDue,
  isValidCron,
  describeCron,
  parseCron,
} from "../../src/lib/agent/schedule";

const UTC = "UTC";
// 2026-01-05 is a Monday, which keeps the weekday cases readable.
const mon = (hhmm: string) => new Date(`2026-01-05T${hhmm}:00.000Z`);
const sat = (hhmm: string) => new Date(`2026-01-10T${hhmm}:00.000Z`);
const sun = (hhmm: string) => new Date(`2026-01-11T${hhmm}:00.000Z`);

describe("matchesCron", () => {
  it("matches the exact minute and nothing either side of it", () => {
    expect(matchesCron("0 9 * * 1-5", mon("09:00"), UTC)).toBe(true);
    expect(matchesCron("0 9 * * 1-5", mon("09:01"), UTC)).toBe(false);
    expect(matchesCron("0 9 * * 1-5", mon("08:59"), UTC)).toBe(false);
  });

  it("honours day-of-week ranges", () => {
    expect(matchesCron("0 9 * * 1-5", sat("09:00"), UTC)).toBe(false);
    expect(matchesCron("0 9 * * 6", sat("09:00"), UTC)).toBe(true);
  });

  it("accepts both 0 and 7 for Sunday, as crontab does", () => {
    expect(matchesCron("0 9 * * 0", sun("09:00"), UTC)).toBe(true);
    expect(matchesCron("0 9 * * 7", sun("09:00"), UTC)).toBe(true);
  });

  it("handles steps, lists and ranges", () => {
    for (const m of ["00", "15", "30", "45"]) {
      expect(matchesCron("*/15 * * * *", mon(`13:${m}`), UTC)).toBe(true);
    }
    expect(matchesCron("*/15 * * * *", mon("13:07"), UTC)).toBe(false);
    expect(matchesCron("0 8,17 * * *", mon("17:00"), UTC)).toBe(true);
    expect(matchesCron("0 8,17 * * *", mon("12:00"), UTC)).toBe(false);
    expect(matchesCron("0 9-11 * * *", mon("10:00"), UTC)).toBe(true);
    expect(matchesCron("0 9-11 * * *", mon("12:00"), UTC)).toBe(false);
  });

  it("treats restricted day-of-month and day-of-week as OR, not AND", () => {
    // "0 0 1 * 1" is the 1st of the month OR any Monday. 2026-01-05 is a
    // Monday and not the 1st, so an AND reading would wrongly skip it.
    expect(matchesCron("0 0 1 * 1", mon("00:00"), UTC)).toBe(true);
    // 2026-01-01 is a Thursday — matches on day-of-month alone.
    expect(matchesCron("0 0 1 * 1", new Date("2026-01-01T00:00:00Z"), UTC)).toBe(true);
    // A Wednesday that isn't the 1st matches neither.
    expect(matchesCron("0 0 1 * 1", new Date("2026-01-07T00:00:00Z"), UTC)).toBe(false);
  });

  it("reads the clock in the business's time zone, not the server's", () => {
    // 06:00 in Johannesburg is 04:00 UTC. A morning brief written as "0 6"
    // must fire then — evaluating in UTC would fire it at 08:00 local.
    const fourUtc = new Date("2026-01-05T04:00:00Z");
    expect(matchesCron("0 6 * * 1-5", fourUtc, "Africa/Johannesburg")).toBe(true);
    expect(matchesCron("0 6 * * 1-5", fourUtc, UTC)).toBe(false);
  });

  it("refuses malformed expressions rather than matching everything", () => {
    expect(matchesCron("not a schedule", mon("09:00"), UTC)).toBe(false);
    expect(matchesCron("0 9 * *", mon("09:00"), UTC)).toBe(false); // four fields
    expect(matchesCron("0 99 * * *", mon("09:00"), UTC)).toBe(false);
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("61 * * * *")).toBe(false);
    expect(() => parseCron("* * * *")).toThrow();
  });
});

describe("isDue", () => {
  it("fires exactly once per slot across a day of half-hourly ticks", () => {
    // The tick runs every 30 minutes, so "does this minute match" would miss
    // a 09:00 schedule entirely unless a tick landed precisely on it.
    let lastRunAt: Date | null = null;
    let fires = 0;

    for (let i = 0; i < 48; i++) {
      const now = new Date(Date.UTC(2026, 0, 5, 0, 0, 0) + i * 30 * 60_000);
      if (isDue({ expr: "0 9 * * *", lastRunAt, now, timeZone: UTC })) {
        fires++;
        lastRunAt = now;
      }
    }
    expect(fires).toBe(1);
  });

  it("still fires when no tick lands on the scheduled minute", () => {
    // Ticks at :05 and :35 never coincide with a :00 schedule.
    const lastRunAt = new Date("2026-01-05T08:05:00Z");
    const now = new Date("2026-01-05T09:05:00Z");
    expect(isDue({ expr: "0 9 * * *", lastRunAt, now, timeZone: UTC })).toBe(true);
  });

  it("does not fire twice for the same slot", () => {
    const lastRunAt = new Date("2026-01-05T09:00:00Z");
    expect(
      isDue({ expr: "0 9 * * *", lastRunAt, now: new Date("2026-01-05T09:30:00Z"), timeZone: UTC })
    ).toBe(false);
  });

  it("does not fire a brand-new agent for a slot that already passed today", () => {
    // Created at 15:00 with a 06:00 schedule: the next run is tomorrow, not
    // the instant it is saved.
    expect(
      isDue({ expr: "0 6 * * *", lastRunAt: null, now: mon("15:00"), timeZone: UTC })
    ).toBe(false);
  });

  it("catches up once, not sixty times, after a long outage", () => {
    // Silent for a month. The owner wants today's brief, not thirty of them.
    let lastRunAt: Date | null = new Date("2025-12-05T09:00:00Z");
    let fires = 0;
    for (let i = 0; i < 3; i++) {
      const now = new Date(Date.UTC(2026, 0, 5, 10, 0, 0) + i * 30 * 60_000);
      if (isDue({ expr: "0 9 * * *", lastRunAt, now, timeZone: UTC })) {
        fires++;
        lastRunAt = now;
      }
    }
    expect(fires).toBe(1);
  });

  it("is never due without a schedule, or with a broken one", () => {
    const now = mon("09:00");
    expect(isDue({ expr: null, lastRunAt: null, now, timeZone: UTC })).toBe(false);
    expect(isDue({ expr: "   ", lastRunAt: null, now, timeZone: UTC })).toBe(false);
    expect(isDue({ expr: "every morning", lastRunAt: null, now, timeZone: UTC })).toBe(false);
  });
});

describe("describeCron", () => {
  it("says when it runs in words an owner can read", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(describeCron("0 6 * * 1-5")).toBe("Weekdays at 06:00");
    expect(describeCron("30 17 * * 0,6")).toBe("Weekends at 17:30");
    expect(describeCron("0 7 * * 1")).toBe("Every Monday at 07:00");
    expect(describeCron("0 8 * * *")).toBe("Every day at 08:00");
    expect(describeCron("0 9 1 * *")).toBe("On the 1st of each month at 09:00");
    expect(describeCron("*/15 * * * *")).toBe("Every day every 15 minutes");
  });

  it("says so plainly rather than guessing wrongly", () => {
    expect(describeCron(null)).toBe("Runs when you ask");
    expect(describeCron("")).toBe("Runs when you ask");
    expect(describeCron("nonsense")).toBe("Schedule not understood");
  });
});
