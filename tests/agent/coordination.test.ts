// The coordination layer.
//
// Almost everything worth testing here is a refusal or a merge: that a
// rejected suggestion never comes back, that three officers noticing one
// problem reach a person once, that an officer set to watch quietly stays
// quiet, and that the daily budget actually holds.
//
// The ranking is tested by consequence rather than by asserting a score. What
// matters is which item comes first, not that the arithmetic produced 412.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  observe,
  handOff,
  decide,
  expireStale,
  officerHistory,
  listOpen,
} from "../../src/lib/agent/observations";
import {
  buildBrief,
  currentBrief,
  approvalQueue,
  DAILY_ATTENTION_BUDGET,
} from "../../src/lib/agent/chiefOfStaff";
import {
  getCeiling,
  getCeilings,
  reaches,
  setCeiling,
  may,
  assertMay,
  listCeilings,
  RungRefusedError,
} from "../../src/lib/agent/ladder";

let tenantId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Coord Co", niche: "SERVICES" } });
  tenantId = t.id;
});

afterEach(async () => {
  await prisma.observation.deleteMany({ where: { tenantId } });
  await prisma.officerAutonomy.deleteMany({ where: { tenantId } });
  await prisma.aiDraft.deleteMany({ where: { tenantId } });
  await prisma.agentRun.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

const base = {
  headline: "Something happened",
  dedupeKey: "k1",
  confidence: 80,
};

// ------------------------------------------------------------------ ladder

describe("the autonomy ladder", () => {
  it("gives each officer a different sensible default", async () => {
    // The COO's useful acts are reversible; the CFO's are not.
    expect(await getCeiling(tenantId, "COO")).toBe("PROPOSE");
    expect(await getCeiling(tenantId, "CFO")).toBe("DRAFT");
    expect(await getCeiling(tenantId, "CEO")).toBe("SUGGEST");
  });

  it("refuses to raise an officer above its hard cap", async () => {
    // An officer whose whole job is judgement should not also have hands.
    await expect(setCeiling({ tenantId, officer: "CEO", ceiling: "ACT" })).rejects.toThrow(
      /cannot go above suggest/
    );
    await expect(setCeiling({ tenantId, officer: "LEGAL", ceiling: "PROPOSE" })).rejects.toThrow(
      /deliberate/
    );
  });

  it("allows raising one that is not capped", async () => {
    await setCeiling({ tenantId, officer: "CFO", ceiling: "PROPOSE" });
    expect(await getCeiling(tenantId, "CFO")).toBe("PROPOSE");
    expect(await may(tenantId, "CFO", "PROPOSE")).toBe(true);
    expect(await may(tenantId, "CFO", "ACT")).toBe(false);
  });

  it("falls to the most cautious rung when the stored value is nonsense", async () => {
    await prisma.officerAutonomy.create({
      data: { tenantId, officer: "SALES", ceiling: "WHATEVER" },
    });
    // A typo in a settings row must never widen what an agent may do.
    expect(await getCeiling(tenantId, "SALES")).toBe("OBSERVE");
  });

  it("throws something a person can act on", async () => {
    await expect(assertMay(tenantId, "CEO", "ACT")).rejects.toThrow(RungRefusedError);
    await expect(assertMay(tenantId, "CEO", "ACT")).rejects.toThrow(/Raise it in settings/);
  });

  it("reads every officer's ceiling at once exactly as it reads each one alone", async () => {
    await setCeiling({ tenantId, officer: "CFO", ceiling: "PROPOSE" });
    await setCeiling({ tenantId, officer: "EFFICIENCY", ceiling: "OBSERVE" });
    await prisma.officerAutonomy.create({ data: { tenantId, officer: "SALES", ceiling: "WHATEVER" } });

    const ceilingOf = await getCeilings(tenantId);
    for (const officer of ["CEO", "CFO", "COO", "LEGAL", "SALES", "EFFICIENCY", "SYSTEM"] as const) {
      expect(ceilingOf(officer)).toBe(await getCeiling(tenantId, officer));
    }
    expect(reaches(ceilingOf("CFO"), "PROPOSE")).toBe(true);
    expect(reaches(ceilingOf("EFFICIENCY"), "SUGGEST")).toBe(false);
  });

  it("reports which officers are capped", async () => {
    const settings = await listCeilings(tenantId);
    const ceo = settings.find((s) => s.officer === "CEO")!;
    expect(ceo.capped).toBe(true);
    expect(ceo.maxAllowed).toBe("SUGGEST");
    const coo = settings.find((s) => s.officer === "COO")!;
    expect(coo.capped).toBe(false);
  });
});

// --------------------------------------------------------------- the bus

describe("the observation bus", () => {
  it("never re-raises something the business rejected", async () => {
    const o = await observe({ tenantId, officer: "CFO", ...base });
    await decide({ tenantId, observationId: o!.id, actioned: false, note: "Deliberate." });

    // Re-suggesting something somebody said no to is the fastest way to make
    // an assistant feel stupid.
    const again = await observe({ tenantId, officer: "CFO", ...base });
    expect(again).toBeNull();
  });

  it("lets a rejection lapse after long enough", async () => {
    const o = await observe({ tenantId, officer: "CFO", ...base });
    await decide({ tenantId, observationId: o!.id, actioned: false });
    // Push the decision back beyond the respected window.
    await prisma.observation.update({
      where: { id: o!.id },
      data: { decidedAt: new Date(Date.now() - 200 * 86_400_000) },
    });

    const again = await observe({ tenantId, officer: "CFO", ...base });
    expect(again).not.toBeNull();
  });

  it("supersedes rather than duplicates on the same key", async () => {
    await observe({ tenantId, officer: "CFO", ...base, headline: "Owed R4,000" });
    await observe({ tenantId, officer: "CFO", ...base, headline: "Owed R9,000" });

    const open = await listOpen(tenantId);
    // The bus holds the current state of a problem, not a log of every time
    // somebody noticed it.
    expect(open).toHaveLength(1);
    expect(open[0].headline).toBe("Owed R9,000");
    expect(open[0].supersedesId).not.toBeNull();
  });

  it("allows exactly one handoff", async () => {
    const o = await observe({ tenantId, officer: "CFO", ...base });
    await handOff({ tenantId, observationId: o!.id, to: "SALES", note: "Your conversation." });

    const after = await prisma.observation.findUnique({ where: { id: o!.id } });
    expect(after!.handedTo).toBe("SALES");
    expect(after!.detail).toContain("Your conversation");

    // A second hop means nobody owns it.
    await expect(handOff({ tenantId, observationId: o!.id, to: "COO" })).rejects.toThrow(
      /already been handed over/
    );
  });

  it("keeps something only just overdue — that is when it matters most", async () => {
    await observe({
      tenantId,
      officer: "COO",
      ...base,
      urgentBy: new Date(Date.now() - 86_400_000),
    });
    expect(await expireStale(tenantId)).toBe(0);
    expect(await listOpen(tenantId)).toHaveLength(1);
  });

  it("expires what is long past the point of acting", async () => {
    const o = await observe({
      tenantId,
      officer: "COO",
      ...base,
      urgentBy: new Date(Date.now() - 45 * 86_400_000),
    });
    const count = await expireStale(tenantId);
    expect(count).toBe(1);

    const after = await prisma.observation.findUnique({ where: { id: o!.id } });
    expect(after!.status).toBe("EXPIRED");
  });

  it("reads back what this business accepts and rejects", async () => {
    const a = await observe({ tenantId, officer: "SALES", ...base, dedupeKey: "a" });
    const b = await observe({ tenantId, officer: "SALES", ...base, dedupeKey: "b" });
    await decide({ tenantId, observationId: a!.id, actioned: true });
    await decide({ tenantId, observationId: b!.id, actioned: false, note: "Not our style." });

    const history = await officerHistory(tenantId, "SALES");
    expect(history.map((h) => h.outcome).sort()).toEqual(["accepted", "rejected"]);
    expect(history.find((h) => h.outcome === "rejected")!.why).toBe("Not our style.");
  });

  it("will not touch another workspace's observation", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other C", niche: "SERVICES" } });
    const o = await observe({ tenantId, officer: "CFO", ...base });
    await expect(
      decide({ tenantId: other.id, observationId: o!.id, actioned: true })
    ).rejects.toThrow(/not found/);
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

// ------------------------------------------------------- chief of staff

describe("the chief of staff", () => {
  it("ranks money above recency", async () => {
    await observe({
      tenantId,
      officer: "COO",
      headline: "A small recent thing",
      dedupeKey: "small",
      moneyCents: 50_00,
      confidence: 90,
    });
    await observe({
      tenantId,
      officer: "CFO",
      headline: "A large thing",
      dedupeKey: "large",
      moneyCents: 400_000_00,
      confidence: 90,
    });

    const brief = await buildBrief(tenantId);
    // An assistant that cannot rank by money ranks by recency, which is how
    // trivia crowds out the thing that mattered.
    expect(brief.items[0].headline).toBe("A large thing");
  });

  it("merges what several officers noticed about one subject", async () => {
    const customer = await prisma.party.create({
      data: { tenantId, name: "Struggling Ltd", role: "CUSTOMER" },
    });

    for (const [officer, headline] of [
      ["CFO", "They are 60 days late"],
      ["SALES", "Their volume is falling"],
      ["LEGAL", "Their contract renews next month"],
    ] as const) {
      await observe({
        tenantId,
        officer,
        headline,
        dedupeKey: `${officer}-struggling`,
        subjectType: "customer",
        subjectId: customer.id,
        moneyCents: 80_000_00,
        confidence: 85,
      });
    }

    const brief = await buildBrief(tenantId);
    // One conversation to have with that customer, not three interruptions.
    expect(brief.items).toHaveLength(1);
    expect(brief.items[0].alsoNoticedBy).toHaveLength(2);
    expect(brief.items[0].mergedIds).toHaveLength(2);
  });

  it("holds to the daily budget and says what it held back", async () => {
    for (let i = 0; i < DAILY_ATTENTION_BUDGET + 3; i++) {
      await observe({
        tenantId,
        officer: "COO",
        headline: `Thing ${i}`,
        dedupeKey: `t${i}`,
        moneyCents: (i + 1) * 1000_00,
        confidence: 80,
      });
    }

    const brief = await buildBrief(tenantId);
    expect(brief.items).toHaveLength(DAILY_ATTENTION_BUDGET);
    expect(brief.heldBack).toBe(3);

    // What was held back is still on the bus, not lost.
    const stillOpen = await listOpen(tenantId);
    expect(stillOpen).toHaveLength(3);
  });

  it("keeps an officer below suggest genuinely silent", async () => {
    await setCeiling({ tenantId, officer: "EFFICIENCY", ceiling: "OBSERVE" });

    await observe({
      tenantId,
      officer: "EFFICIENCY",
      headline: "Watching quietly",
      dedupeKey: "quiet",
      moneyCents: 900_000_00,
      confidence: 99,
    });

    const brief = await buildBrief(tenantId);
    // It may write; it simply never reaches anybody.
    expect(brief.items).toHaveLength(0);
    expect(await listOpen(tenantId)).toHaveLength(1);
  });

  it("leads the headline with the problem, not a count", async () => {
    await observe({
      tenantId,
      officer: "CFO",
      headline: "VAT is due in four days and the money is not set aside",
      dedupeKey: "vat",
      moneyCents: 120_000_00,
      confidence: 95,
      urgentBy: new Date(Date.now() + 4 * 86_400_000),
    });
    await observe({
      tenantId, officer: "COO", headline: "Minor", dedupeKey: "m", moneyCents: 100_00,
    });

    const brief = await buildBrief(tenantId);
    expect(brief.headline).toMatch(/^VAT is due in four days/);
    // Joined to the stem, not appended after the officer's full stop.
    expect(brief.headline).toContain(", and 1 other thing.");
    expect(brief.headline).not.toContain(". and");
  });

  it("says nothing when there is nothing", async () => {
    const brief = await buildBrief(tenantId);
    expect(brief.items).toHaveLength(0);
    expect(brief.headline).toBe("");
  });

  it("does not raise the same thing twice", async () => {
    await observe({ tenantId, officer: "CFO", ...base, moneyCents: 10_000_00 });

    const first = await buildBrief(tenantId);
    expect(first.items).toHaveLength(1);

    const second = await buildBrief(tenantId);
    expect(second.items).toHaveLength(0);
  });
});

// --------------------------------------------------------- the same brief
//
// Two callers, one judgement. buildBrief() is the interrupting path and must
// not raise the same thing twice; currentBrief() is the screen and must not
// consume what it renders. A page built on buildBrief() would show its
// findings once and then an empty desk forever, which is a memorable way to
// lose a CFO's work.

describe("the brief on a screen", () => {
  const base = {
    headline: "Something is wrong.",
    dedupeKey: "cfo:thing",
    confidence: 90,
  };

  it("does not consume itself when rendered twice", async () => {
    await observe({ tenantId, officer: "CFO", ...base, moneyCents: 10_000_00 });

    const first = await currentBrief(tenantId);
    const second = await currentBrief(tenantId);

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].observationId).toBe(first.items[0].observationId);
  });

  it("still shows what the tick already raised", async () => {
    await observe({ tenantId, officer: "CFO", ...base, moneyCents: 10_000_00 });
    await buildBrief(tenantId); // the tick gets there first and marks it raised

    // Reading only RAISED would leave a workspace blank until its first tick;
    // reading only OPEN would blank it the moment the tick ran. Both.
    const screen = await currentBrief(tenantId);
    expect(screen.items).toHaveLength(1);
  });

  it("drops a finding the owner has decided on", async () => {
    await observe({ tenantId, officer: "CFO", ...base, moneyCents: 10_000_00 });
    const shown = await currentBrief(tenantId);

    await decide({ tenantId, observationId: shown.items[0].observationId, actioned: true });

    expect((await currentBrief(tenantId)).items).toHaveLength(0);
  });

  it("ranks identically to the notification path", async () => {
    await observe({
      tenantId, officer: "CFO", headline: "Small.", dedupeKey: "a",
      moneyCents: 500_00, confidence: 90,
    });
    await observe({
      tenantId, officer: "COO", headline: "Large.", dedupeKey: "b",
      moneyCents: 400_000_00, confidence: 90,
    });

    // The screen disagreeing with the notification about what matters most is
    // the one thing a coordination layer cannot do.
    const screen = await currentBrief(tenantId);
    const tick = await buildBrief(tenantId);
    expect(screen.items.map((i) => i.headline)).toEqual(tick.items.map((i) => i.headline));
  });

  it("holds the same number back as the tick would", async () => {
    for (let i = 0; i < DAILY_ATTENTION_BUDGET + 3; i++) {
      await observe({
        tenantId, officer: "CFO", headline: `Thing ${i}.`,
        dedupeKey: `k${i}`, moneyCents: (i + 1) * 1_000_00, confidence: 80,
      });
    }

    const screen = await currentBrief(tenantId);
    expect(screen.items).toHaveLength(DAILY_ATTENTION_BUDGET);
    expect(screen.heldBack).toBe(3);
  });
});

// ------------------------------------------------------------------ queue

describe("one approval queue", () => {
  it("puts observations, staged actions and drafts in one ranked list", async () => {
    const customer = await prisma.party.create({
      data: { tenantId, name: "A Customer", role: "CUSTOMER" },
    });
    const invoice = await prisma.transaction.create({
      data: { tenantId, partyId: customer.id, type: "INVOICE", status: "SENT", amountCents: 1000 },
    });

    await observe({
      tenantId, officer: "CFO", headline: "Something worth money",
      dedupeKey: "q1", moneyCents: 500_000_00, confidence: 95,
      urgentBy: new Date(Date.now() - 86_400_000),
    });
    await buildBrief(tenantId);

    await prisma.agentRun.create({
      data: { tenantId, trigger: "USER", status: "AWAITING_APPROVAL", input: "Pay the supplier" },
    });
    await prisma.aiDraft.create({
      data: {
        tenantId, partyId: customer.id, transactionId: invoice.id,
        touchNumber: 1, body: "Hello", reasoning: "Third follow-up, firmer tone",
      },
    });

    const queue = await approvalQueue(tenantId);
    // Three places to check becomes one — which is the whole point, and an
    // odd thing to get wrong while building the fix for it.
    expect(queue.map((q) => q.kind).sort()).toEqual([
      "agent_action",
      "draft_message",
      "observation",
    ]);
    expect(queue.every((q) => q.title.length > 0)).toBe(true);
  });

  it("is empty when nothing is waiting", async () => {
    expect(await approvalQueue(tenantId)).toEqual([]);
  });
});
