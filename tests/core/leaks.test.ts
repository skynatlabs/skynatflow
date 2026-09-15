// Progress billing, branches, languages and portability.
//
// The behaviour worth defending in each: that claims never drift from the
// agreed total however the percentages fall, that unassigned money is
// reported rather than spread, that a document always renders even in a
// language we do not have, and that the export cannot quietly stop being
// complete.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../../src/lib/db";
import {
  createAgreement,
  previewClaim,
  raiseClaim,
  retentionHeld,
  agreementPositions,
  settleRetention,
} from "../../src/lib/core/progressBilling";
import { compareBranches, createBranch, assignToBranch } from "../../src/lib/core/branches";
import { documentStrings, languageName, messageLanguagePrompt } from "../../src/lib/core/documentLanguage";
import { exportTenant, toCsv, exportCoverage, EXPORT_KEYS } from "../../src/lib/core/portability";
import { ensureChartOfAccounts, postEntry } from "../../src/lib/core/ledger";

let tenantId: string;
let partyId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Leaks Co", niche: "SERVICES" } });
  tenantId = t.id;
  const p = await prisma.party.create({
    data: { tenantId, name: "Mkhize Construction", role: "CUSTOMER" },
  });
  partyId = p.id;
});

afterEach(async () => {
  await prisma.progressClaim.deleteMany({ where: { tenantId } });
  await prisma.progressAgreement.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.journalLine.deleteMany({ where: { entry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.branch.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

// -------------------------------------------------------- progress billing

describe("progress claims", () => {
  it("bills the difference, not the percentage", async () => {
    const a = await createAgreement({
      tenantId,
      partyId,
      title: "Roof replacement",
      totalValueCents: 2_400_000,
      retentionPercent: 10,
    });

    const first = await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 30 });
    expect(first.breakdown.grossCents).toBe(720_000);
    expect(first.breakdown.retentionCents).toBe(72_000);
    expect(first.breakdown.netCents).toBe(648_000);

    // 60% cumulative is another 30%, not another 60%.
    const second = await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 60 });
    expect(second.breakdown.grossCents).toBe(720_000);
    expect(second.breakdown.retentionHeldToDateCents).toBe(144_000);
  });

  it("lands exactly on the agreed total however the percentages fall", async () => {
    // Thirds do not divide evenly into cents, which is where a
    // slice-by-slice calculation drifts and a cumulative one does not.
    const a = await createAgreement({
      tenantId,
      partyId,
      title: "Awkward thirds",
      totalValueCents: 1_000_000,
    });

    await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 33.33 });
    await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 66.66 });
    await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 100 });

    const [position] = await agreementPositions(tenantId);
    expect(position.claimedGrossCents).toBe(1_000_000);
    expect(position.remainingCents).toBe(0);
  });

  it("refuses a claim that does not advance the job", async () => {
    const a = await createAgreement({
      tenantId,
      partyId,
      title: "No going back",
      totalValueCents: 100_000,
    });
    await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 50 });

    await expect(
      previewClaim({ tenantId, agreementId: a.id, percentComplete: 40 })
    ).rejects.toThrow(/already claimed to 50/);
    await expect(
      previewClaim({ tenantId, agreementId: a.id, percentComplete: 120 })
    ).rejects.toThrow(/more than 100/);
  });

  it("turns retention into a dated obligation when the job finishes", async () => {
    const a = await createAgreement({
      tenantId,
      partyId,
      title: "Slab and roof",
      totalValueCents: 1_000_000,
      retentionPercent: 10,
    });

    const mid = await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 50 });
    // Not yet — the job is still running.
    expect(mid.retentionObligationId).toBeNull();

    const final = await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 100 });
    expect(final.retentionObligationId).not.toBeNull();

    // The moment everybody stops thinking about the job is the moment the
    // money is most likely to be forgotten, so it goes on the same radar as
    // a lapsing licence.
    const obligation = await prisma.obligation.findUnique({
      where: { id: final.retentionObligationId! },
    });
    expect(obligation!.title).toContain("Retention release");
    expect(obligation!.partyId).toBe(partyId);
    expect(obligation!.consequence).toContain("being held");
    expect(obligation!.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reports how much of the operator's money other people hold", async () => {
    const a = await createAgreement({
      tenantId,
      partyId,
      title: "Job one",
      totalValueCents: 1_000_000,
      retentionPercent: 10,
    });
    await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 100 });

    const held = await retentionHeld(tenantId);
    expect(held.totalHeldCents).toBe(100_000);
    expect(held.onCompleteJobsCents).toBe(100_000);
    expect(held.summary).toContain("being held as retention");
    expect(held.summary).toContain("already finished");
  });

  it("will not settle retention on a job still running", async () => {
    const a = await createAgreement({
      tenantId,
      partyId,
      title: "Still going",
      totalValueCents: 500_000,
      retentionPercent: 5,
    });
    await raiseClaim({ tenantId, agreementId: a.id, percentComplete: 40 });
    await expect(settleRetention({ tenantId, agreementId: a.id })).rejects.toThrow(/isn't finished/);
  });

  it("refuses a nonsense retention percentage", async () => {
    await expect(
      createAgreement({
        tenantId,
        partyId,
        title: "Bad",
        totalValueCents: 100_000,
        retentionPercent: 150,
      })
    ).rejects.toThrow(/between 0 and 100/);
  });
});

// ---------------------------------------------------------------- branches

describe("branches", () => {
  it("reports unassigned money as its own row rather than spreading it", async () => {
    await ensureChartOfAccounts(tenantId);
    const jhb = await createBranch({ tenantId, name: "Johannesburg" });
    const cpt = await createBranch({ tenantId, name: "Cape Town" });

    const sale = async (branchId: string | null, cents: number) => {
      const entry = await postEntry({
        tenantId,
        entryDate: new Date("2026-04-10T12:00:00Z"),
        memo: "Sale",
        lines: [
          { accountCode: "1000", debitCents: cents },
          { accountCode: "4000", creditCents: cents },
        ],
      });
      if (branchId) {
        await prisma.journalEntry.update({ where: { id: entry.id }, data: { branchId } });
      }
    };

    await sale(jhb.id, 600_000);
    await sale(cpt.id, 200_000);
    await sale(null, 100_000); // nobody tagged this one

    const comparison = await compareBranches(tenantId, {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T23:59:59Z"),
    });

    expect(comparison.branches.map((b) => b.name)).toEqual(["Johannesburg", "Cape Town"]);
    expect(comparison.branches[0].incomeCents).toBe(600_000);
    expect(comparison.branches[1].incomeCents).toBe(200_000);

    // The honest answer, not a pro-rata invention.
    expect(comparison.unassigned).not.toBeNull();
    expect(comparison.unassigned!.incomeCents).toBe(100_000);
    expect(comparison.caveats.some((c) => c.includes("Assign the unassigned"))).toBe(true);
  });

  it("names the branch the combined figure was hiding", async () => {
    await ensureChartOfAccounts(tenantId);
    const good = await createBranch({ tenantId, name: "Profitable" });
    const bad = await createBranch({ tenantId, name: "Struggling" });

    const entry = async (branchId: string, income: number, cost: number) => {
      const e1 = await postEntry({
        tenantId,
        entryDate: new Date("2026-04-10T12:00:00Z"),
        memo: "Sale",
        lines: [
          { accountCode: "1000", debitCents: income },
          { accountCode: "4000", creditCents: income },
        ],
      });
      await prisma.journalEntry.update({ where: { id: e1.id }, data: { branchId } });
      const e2 = await postEntry({
        tenantId,
        entryDate: new Date("2026-04-10T12:00:00Z"),
        memo: "Rent",
        lines: [
          { accountCode: "5200", debitCents: cost },
          { accountCode: "1000", creditCents: cost },
        ],
      });
      await prisma.journalEntry.update({ where: { id: e2.id }, data: { branchId } });
    };

    await entry(good.id, 900_000, 200_000);
    await entry(bad.id, 100_000, 400_000);

    const comparison = await compareBranches(tenantId, {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T23:59:59Z"),
    });
    // The whole point of the feature: the loss-making site, named.
    expect(comparison.summary).toContain("Struggling");
    expect(comparison.summary).toContain("hides");
  });

  it("will not create two branches with the same name", async () => {
    await createBranch({ tenantId, name: "Durban" });
    await expect(createBranch({ tenantId, name: "Durban" })).rejects.toThrow(/already a branch/);
  });

  it("will not assign rows to another workspace's branch", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other B", niche: "SERVICES" } });
    const theirs = await createBranch({ tenantId: other.id, name: "Theirs" });
    await expect(
      assignToBranch({ tenantId, branchId: theirs.id, transactionIds: ["x"] })
    ).rejects.toThrow(/Branch not found/);
    await prisma.branch.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

// --------------------------------------------------------------- languages

describe("document language", () => {
  it("returns the right labels for a language we have", () => {
    expect(documentStrings("af").invoice).toBe("Faktuur");
    expect(documentStrings("zu").total).toBe("Isamba");
    expect(languageName("st")).toBe("Sesotho");
  });

  it("falls back to English rather than failing to render", () => {
    // A customer seeing English labels is a far smaller problem than a quote
    // that does not generate.
    expect(documentStrings("kl").invoice).toBe("Invoice");
    expect(documentStrings(null).total).toBe("Total");
    expect(documentStrings(undefined).vat).toBe("VAT");
  });

  it("gives every language a complete set of labels", () => {
    // A half-translated document is worse than an English one, because the
    // gaps look like bugs to the customer reading it.
    const english = Object.keys(documentStrings("en"));
    for (const code of ["af", "zu", "xh", "st", "tn"]) {
      const strings = documentStrings(code) as unknown as Record<string, string>;
      for (const key of english) {
        expect(strings[key], `${code} is missing ${key}`).toBeTruthy();
      }
    }
  });

  it("tells the model to leave figures alone", () => {
    const prompt = messageLanguagePrompt("zu");
    expect(prompt).toContain("isiZulu");
    expect(prompt).toContain("never the figures themselves");
  });

  it("says nothing for English", () => {
    expect(messageLanguagePrompt("en")).toBe("");
    expect(messageLanguagePrompt(null)).toBe("");
  });
});

// ------------------------------------------------------------- portability

describe("taking everything and leaving", () => {
  it("exports every table with a manifest that describes it", async () => {
    await ensureChartOfAccounts(tenantId);
    const result = await exportTenant(tenantId);

    expect(result.manifest.businessName).toBe("Leaks Co");
    expect(result.manifest.tables.length).toBe(EXPORT_KEYS.length);
    expect(Object.keys(result.data).sort()).toEqual([...EXPORT_KEYS].sort());

    // The customer created in setup, and the chart of accounts.
    expect(result.data.parties).toHaveLength(1);
    expect((result.data.accounts as unknown[]).length).toBeGreaterThan(20);

    // The notes are what makes the file usable by somebody who is not us.
    expect(result.manifest.notes.some((n) => n.includes("integer cents"))).toBe(true);
    expect(result.manifest.notes.some((n) => n.includes("base64"))).toBe(true);
  });

  it("covers every tenant-scoped table in the schema", () => {
    // The failure this feature is most prone to: somebody adds a model,
    // nobody adds it here, and the export quietly stops being complete while
    // still calling itself complete.
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

    const tenantScoped: string[] = [];
    for (const block of schema.split(/^model /m).slice(1)) {
      const mapped = /@@map\("([a-z_]+)"\)/.exec(block);
      if (!mapped) continue;
      const name = mapped[1];
      // Tenant-scoped means it carries a tenantId, or hangs off something
      // that does. The latter are exported through their parent.
      if (!/\btenantId\s+String/.test(block)) continue;
      tenantScoped.push(name);
    }

    const coverage = exportCoverage(tenantScoped);
    expect(
      coverage.missing,
      "these tenant-scoped tables exist but nothing exports them — add them to " +
        "src/lib/core/portability.ts or the export is not what it claims to be"
    ).toEqual([]);
  });

  it("writes CSV that survives commas, quotes and newlines", () => {
    const csv = toCsv([
      { name: 'Say "hello", loudly', note: "line one\nline two", amount: 1234 },
      { name: "Plain", note: null, amount: 0 },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("name,note,amount");
    expect(lines[1]).toContain('"Say ""hello"", loudly"');
    // The embedded newline stays inside its quoted field rather than
    // becoming a new row.
    expect(csv).toContain('"line one\nline two"');
    expect(csv.trim().endsWith("Plain,,0")).toBe(true);
  });

  it("returns empty rather than a header for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});
