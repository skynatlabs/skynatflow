// The obligation library. The property worth defending here is not that South
// Africa works — it is that nothing about the code path is South African. A
// jurisdiction the authors have never heard of has to behave identically to
// the one we shipped with, purely on the strength of rows in a table.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  adoptFromDocument,
  buildCalendarFromLibrary,
  contributeTemplate,
  jurisdictionStatus,
  nextDueFor,
  recordDismissal,
  templatesFor,
  type BusinessProfile,
} from "../../src/lib/core/obligationLibrary";

let tenantId: string;

// A country that does not exist, so nothing can accidentally pass because a
// real jurisdiction was special-cased somewhere.
const NOWHERE = "ZZ";

const baseProfile: BusinessProfile = {
  countryCode: NOWHERE,
  isCompany: true,
  isVatRegistered: false,
  hasEmployees: false,
  hasVehicles: false,
};

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Library Co", niche: "SERVICES" } });
  tenantId = t.id;
});

afterEach(async () => {
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.obligationTemplate.deleteMany({ where: { countryCode: { in: [NOWHERE, "ZY"] } } });
  await prisma.jurisdictionCoverage.deleteMany({
    where: { countryCode: { in: [NOWHERE, "ZY"] } },
  });
});

describe("a jurisdiction nobody coded for", () => {
  it("builds a full calendar from rows alone", async () => {
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "Guild Registration Renewal",
      authority: "Office of the Registrar",
      kind: "COMPLIANCE_FILING",
      recurrence: "ANNUAL",
      severity: "CRITICAL",
      dueMonth: 9,
      dueDay: 30,
      requiresCompany: true,
      consequence: "The guild strikes the business off and its contracts become unenforceable.",
      source: "RESEARCH",
    });

    const result = await buildCalendarFromLibrary(tenantId, baseProfile);
    expect(result.jurisdictionEmpty).toBe(false);
    expect(result.created).toBe(1);

    const rows = await prisma.obligation.findMany({ where: { tenantId } });
    expect(rows[0].title).toBe("Guild Registration Renewal");
    expect(rows[0].severity).toBe("CRITICAL");
    // The consequence has to survive the trip — it is what makes anyone act.
    expect(rows[0].consequence).toContain("unenforceable");
    // And the row remembers where it came from, so a correction can go back.
    expect(rows[0].templateId).not.toBeNull();
  });

  it("says plainly when it knows nothing about a place", async () => {
    const result = await buildCalendarFromLibrary(tenantId, baseProfile);
    expect(result.jurisdictionEmpty).toBe(true);
    expect(result.created).toBe(0);

    const status = await jurisdictionStatus(NOWHERE);
    expect(status.templateCount).toBe(0);
  });
});

describe("who a template applies to", () => {
  beforeEach(async () => {
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "Everyone Levy",
      kind: "TAX",
      requiresEmployees: null, // does not care
      source: "RESEARCH",
    });
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "Employer Levy",
      kind: "TAX",
      requiresEmployees: true,
      source: "RESEARCH",
    });
  });

  it("keeps an obligation that does not care about a fact", async () => {
    // The bug this guards: treating "null" as "false" and hiding the things
    // that apply to everybody from a business that employs people.
    const forEmployer = await templatesFor({ ...baseProfile, hasEmployees: true });
    expect(forEmployer.map((t) => t.title).sort()).toEqual(["Employer Levy", "Everyone Levy"]);
  });

  it("leaves out what genuinely does not apply", async () => {
    const soleTrader = await templatesFor({ ...baseProfile, hasEmployees: false });
    expect(soleTrader.map((t) => t.title)).toEqual(["Everyone Levy"]);
  });
});

describe("regional rows", () => {
  it("returns country-wide and region rows together", async () => {
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "National Filing",
      kind: "COMPLIANCE_FILING",
      source: "RESEARCH",
    });
    await contributeTemplate({
      countryCode: NOWHERE,
      regionCode: "NX",
      title: "Provincial Permit",
      kind: "LICENCE",
      source: "RESEARCH",
    });
    await contributeTemplate({
      countryCode: NOWHERE,
      regionCode: "NY",
      title: "Other Province Permit",
      kind: "LICENCE",
      source: "RESEARCH",
    });

    // A federal country's business owes both layers, and only its own region's.
    const titles = (await templatesFor({ ...baseProfile, regionCode: "NX" })).map((t) => t.title);
    expect(titles).toContain("National Filing");
    expect(titles).toContain("Provincial Permit");
    expect(titles).not.toContain("Other Province Permit");
  });
});

describe("dates", () => {
  it("uses a fixed national deadline when there is one", () => {
    const t = {
      dueMonth: 9,
      dueDay: 30,
      fromRegistrationAnniversary: false,
    } as Parameters<typeof nextDueFor>[0];
    const { dueAt, needsRealDate } = nextDueFor(t, baseProfile, new Date("2026-01-15T00:00:00Z"));
    expect(dueAt.getUTCMonth()).toBe(8);
    expect(dueAt.getUTCDate()).toBe(30);
    expect(needsRealDate).toBe(false);
  });

  it("follows the business's own anniversary when the deadline does", () => {
    const t = {
      dueMonth: null,
      dueDay: null,
      fromRegistrationAnniversary: true,
    } as Parameters<typeof nextDueFor>[0];
    const { dueAt } = nextDueFor(
      { ...t },
      { ...baseProfile, registrationMonth: 7 },
      new Date("2026-01-15T00:00:00Z")
    );
    expect(dueAt.getUTCMonth()).toBe(6); // July
  });

  it("admits when it is guessing rather than inventing a date", () => {
    const t = {
      dueMonth: null,
      dueDay: null,
      fromRegistrationAnniversary: false,
    } as Parameters<typeof nextDueFor>[0];
    const { needsRealDate } = nextDueFor(t, baseProfile, new Date("2026-01-15T00:00:00Z"));
    expect(needsRealDate).toBe(true);
  });

  it("flags placeholder dates on the built calendar so they get corrected", async () => {
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "Some Policy Renewal",
      kind: "INSURANCE",
      source: "RESEARCH",
    });
    const result = await buildCalendarFromLibrary(tenantId, baseProfile);
    expect(result.needDates).toBe(1);

    const row = await prisma.obligation.findFirst({ where: { tenantId } });
    expect(row!.notes).toContain("set it from your own paperwork");
  });
});

describe("learning from documents", () => {
  it("names the obligation the way the document names it, and teaches the library", async () => {
    const adopted = await adoptFromDocument({
      tenantId,
      title: "Vendor's Licence — Class B",
      kind: "LICENCE",
      authority: "County Auditor",
      reference: "VL-99812",
      expiresOn: new Date("2027-03-31T12:00:00Z"),
      consequence: "Trading without it is a misdemeanour and the stall gets closed.",
      countryCode: NOWHERE,
      regionCode: "NX",
    });

    expect(adopted.needsRealDate).toBe(false);
    expect(adopted.contributedToLibrary).toBe(true);

    // The next business in that county is now offered it, without anyone here
    // having known what a vendor's licence is.
    const forNext = await templatesFor({ ...baseProfile, regionCode: "NX" });
    expect(forNext.map((t) => t.title)).toContain("Vendor's Licence — Class B");
    expect(forNext[0].source).toBe("DOCUMENT");
  });

  it("does not touch the library when the document did not say where it is from", async () => {
    const adopted = await adoptFromDocument({
      tenantId,
      title: "Mystery Certificate",
      kind: "CERTIFICATE",
      countryCode: null,
    });

    expect(adopted.contributedToLibrary).toBe(false);
    // Still on this business's calendar — it is their document either way.
    const row = await prisma.obligation.findFirst({ where: { tenantId } });
    expect(row!.title).toBe("Mystery Certificate");
    // A template filed under the wrong country would propagate, so none was made.
    expect(await prisma.obligationTemplate.count({ where: { title: "Mystery Certificate" } })).toBe(0);
  });

  it("still calendars a document with no stated expiry, and says so", async () => {
    const adopted = await adoptFromDocument({
      tenantId,
      title: "Undated Permit",
      kind: "LICENCE",
      expiresOn: null,
      countryCode: NOWHERE,
    });
    expect(adopted.needsRealDate).toBe(true);
    const row = await prisma.obligation.findFirst({ where: { tenantId } });
    expect(row!.notes).toContain("didn't state an expiry");
  });
});

describe("trust signals", () => {
  it("strengthens an existing row rather than duplicating it", async () => {
    const input = {
      countryCode: NOWHERE,
      title: "Repeat Filing",
      kind: "COMPLIANCE_FILING" as const,
      source: "DOCUMENT" as const,
    };
    await contributeTemplate(input);
    await contributeTemplate({ ...input, authority: "Late-arriving detail" });

    const rows = await prisma.obligationTemplate.findMany({
      where: { countryCode: NOWHERE, title: "Repeat Filing" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].confirmedCount).toBe(1);
    // A gap the first contributor left can be filled by the second.
    expect(rows[0].authority).toBe("Late-arriving detail");
  });

  it("retires a template businesses keep rejecting", async () => {
    const t = await contributeTemplate({
      countryCode: NOWHERE,
      title: "Wrong Guess",
      kind: "LICENCE",
      source: "RESEARCH",
    });

    expect((await templatesFor(baseProfile)).map((x) => x.title)).toContain("Wrong Guess");

    for (let i = 0; i < 3; i++) await recordDismissal(t.id);

    // Three businesses saying it does not apply is enough evidence to stop
    // offering it to the fourth.
    expect((await templatesFor(baseProfile)).map((x) => x.title)).not.toContain("Wrong Guess");
  });

  it("puts curated rows above unproven researched ones", async () => {
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "Researched Thing",
      kind: "TAX",
      source: "RESEARCH",
    });
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "Checked Thing",
      kind: "TAX",
      source: "CURATED",
    });

    const order = (await templatesFor(baseProfile)).map((t) => t.title);
    expect(order[0]).toBe("Checked Thing");
  });
});

describe("building twice", () => {
  it("tops the calendar up rather than duplicating it", async () => {
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "First Thing",
      kind: "TAX",
      requiresEmployees: null,
      source: "RESEARCH",
    });
    await contributeTemplate({
      countryCode: NOWHERE,
      title: "Employer Thing",
      kind: "TAX",
      requiresEmployees: true,
      source: "RESEARCH",
    });

    const first = await buildCalendarFromLibrary(tenantId, baseProfile);
    expect(first.created).toBe(1);

    // They hire someone and answer the question again.
    const second = await buildCalendarFromLibrary(tenantId, {
      ...baseProfile,
      hasEmployees: true,
    });
    expect(second.created).toBe(1);
    expect(second.skipped).toBe(1);

    expect(await prisma.obligation.count({ where: { tenantId } })).toBe(2);
  });
});
