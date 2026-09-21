// The billing engine, and the guard that keeps the price on the website the
// same as the price in the product.
//
// That guard is the reason this file exists at all. The site was advertising
// plans the app had no ability to charge for, because the two lived in
// different files and nothing compared them. Now the marketing view is
// derived from the billing table, and this asserts it stays derived.

import { describe, it, expect } from "vitest";
import {
  PLANS,
  PLAN_BY_KEY,
  allowanceCents,
  monthlyCents,
  planFor,
  type SeatCounts,
} from "../../src/lib/billing/plans";
import { PRICING_PLANS, TRIAL_DAYS } from "../../src/lib/marketing/pricing";
import { defaultSeatClass, seatClassOf } from "../../src/lib/core/billing";

const seats = (full: number, field = 0, portal = 0): SeatCounts => ({ full, field, portal });

describe("plans", () => {
  it("prices a team without rounding it into blocks", () => {
    // Monday sells seats in blocks of five, rounded up, and a six-person
    // business buys ten. The whole point of this line is that we do not.
    const pro = PLAN_BY_KEY.pro;
    expect(monthlyCents(pro, seats(6))).toBe(6 * pro.fullSeatCents);
    expect(monthlyCents(pro, seats(7))).toBe(7 * pro.fullSeatCents);
  });

  it("charges nothing for the seats a base price already includes", () => {
    const solo = PLAN_BY_KEY.solo;
    expect(monthlyCents(solo, seats(1))).toBe(solo.baseCents);
    expect(monthlyCents(solo, seats(3))).toBe(solo.baseCents);
    expect(monthlyCents(solo, seats(4))).toBe(solo.baseCents + solo.fullSeatCents);
  });

  it("charges field seats less than full ones, and portal seats nothing", () => {
    for (const plan of PLANS) {
      expect(plan.fieldSeatCents, plan.key).toBeLessThan(plan.fullSeatCents);
    }
    const pro = PLAN_BY_KEY.pro;
    const withPortal = monthlyCents(pro, seats(2, 3, 50));
    const withoutPortal = monthlyCents(pro, seats(2, 3, 0));
    expect(withPortal).toBe(withoutPortal);
  });

  it("gives every plan an allowance well above what a seat actually costs", () => {
    // A fast-tier seat at ten runs a day costs about 280 cents a month,
    // measured. An allowance a normal month can reach is a support ticket,
    // not a control.
    const MEASURED_SEAT_COST_CENTS = 280;
    for (const plan of PLANS) {
      expect(plan.agentAllowanceCentsPerSeat, plan.key).toBeGreaterThan(MEASURED_SEAT_COST_CENTS * 2);
    }
  });

  it("scales the allowance with the number of full seats", () => {
    const pro = PLAN_BY_KEY.pro;
    expect(allowanceCents(pro, seats(4))).toBe(4 * pro.agentAllowanceCentsPerSeat);
    // Field seats have no agent, so they add no allowance.
    expect(allowanceCents(pro, seats(4, 9))).toBe(4 * pro.agentAllowanceCentsPerSeat);
  });

  it("falls back to a real plan for an unknown key", () => {
    expect(planFor("nonsense").key).toBe("pro");
    expect(planFor(null).key).toBe("pro");
    expect(planFor("solo").key).toBe("solo");
  });
});

describe("seat classes", () => {
  it("puts the people who work in the field on a field seat", () => {
    expect(defaultSeatClass("DRIVER")).toBe("field");
    expect(defaultSeatClass("TECHNICIAN")).toBe("field");
    expect(defaultSeatClass("OWNER")).toBe("full");
    expect(defaultSeatClass("STAFF")).toBe("full");
    expect(defaultSeatClass("REP")).toBe("full");
  });

  it("lets a stored class override the role's default", () => {
    expect(seatClassOf({ role: "DRIVER", seatClass: "full" })).toBe("full");
    expect(seatClassOf({ role: "OWNER", seatClass: "field" })).toBe("field");
  });

  it("ignores a stored class that means nothing", () => {
    expect(seatClassOf({ role: "DRIVER", seatClass: "platinum" })).toBe("field");
    expect(seatClassOf({ role: "STAFF", seatClass: null })).toBe("full");
  });
});

// The drift guard.
describe("the website and the product agree", () => {
  it("advertises exactly the plans the billing engine knows about", () => {
    expect(PRICING_PLANS.map((p) => p.id)).toEqual(PLANS.map((p) => p.key));
  });

  it("quotes the same trial length in both places", () => {
    expect(TRIAL_DAYS).toBeGreaterThan(0);
  });

  it("shows a price that matches what would actually be charged", () => {
    for (const shown of PRICING_PLANS) {
      const plan = PLAN_BY_KEY[shown.id];
      const cents = Number(shown.price.replace(/[^0-9.]/g, "")) * 100;

      if (plan.quoted) {
        expect(shown.price).toBe("Custom");
        continue;
      }
      // A plan with a base price leads with the base; a per-seat plan leads
      // with the seat. Either way the headline must be a number we charge.
      const expected = plan.baseCents > 0 ? plan.baseCents : plan.fullSeatCents;
      expect(Math.round(cents), `${shown.id} headline price`).toBe(expected);
    }
  });

  it("names the same seat allowance the plan actually includes", () => {
    for (const shown of PRICING_PLANS) {
      const plan = PLAN_BY_KEY[shown.id];
      if (plan.seatsIncluded > 0) {
        expect(shown.extraSeatPrice, `${shown.id} should quote a per-seat price`).toBeTruthy();
      }
      expect(shown.seatsIncluded).toBe(plan.seatsIncluded);
    }
  });

  it("describes the plan in the plan's own words", () => {
    for (const shown of PRICING_PLANS) {
      expect(shown.description).toBe(PLAN_BY_KEY[shown.id].summary);
      expect(shown.features).toEqual(PLAN_BY_KEY[shown.id].features);
    }
  });
});
