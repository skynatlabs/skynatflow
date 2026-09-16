// Getting in, and the promises made on the way.
//
// Three of these are anti-drift tests rather than behaviour tests: the setup
// budget, the industry pack and the status page all make a claim that rots
// quietly unless something checks it. The other two are about not being
// dangerous — a server that fetches a URL somebody typed, and an importer
// that would double a customer list.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { PROMISE_SECONDS, budgetSentence, setupBudget } from "../../src/lib/onboarding/budget";
import { STEPS } from "../../src/lib/onboarding/progress";
import { PACKS, applyPack, packFor } from "../../src/lib/core/industryPacks";
import { isPrivateHost, readFacts, safeUrl, scanWebsite } from "../../src/lib/core/websiteScan";
import { preflight, preflightSentence } from "../../src/lib/import/preflight";
import { IMPORT_PRESETS } from "../../src/lib/import/csv";
import { mayRunUnattended, METERS, usage, usageSummary } from "../../src/lib/core/quotas";
import { status } from "../../src/lib/platform/status";

let tenantId: string;

beforeEach(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "New Business", niche: "SERVICES", currency: "ZAR" } });
  tenantId = tenant.id;
});

afterEach(async () => {
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("the three minutes", () => {
  it("keeps the required path inside the promise", () => {
    const report = setupBudget();
    // The claim is about the path somebody actually takes, which is the
    // required one. If this ever fails, something was made compulsory that
    // should not have been.
    expect(report.requiredSeconds).toBeLessThanOrEqual(PROMISE_SECONDS);
    expect(report.withinPromise).toBe(true);
    expect(budgetSentence()).toMatch(/minute/);
  });

  it("prices every step that exists, so a new one cannot slip in uncounted", () => {
    const report = setupBudget();
    expect(report.steps.map((step) => step.key)).toEqual(STEPS.map((step) => step.key));
    for (const step of report.steps) {
      expect(step.fields.length, `${step.key} has no fields priced`).toBeGreaterThan(0);
    }
  });

  it("names the most expensive optional thing, so there is something to cut", () => {
    const report = setupBudget();
    expect(report.mostExpensiveOptional).not.toBeNull();
    expect(report.mostExpensiveOptional!.required).toBe(false);
    // And the thorough path is honestly longer than the required one.
    expect(report.thoroughSeconds).toBeGreaterThan(report.requiredSeconds);
  });
});

describe("setting a trade up", () => {
  it("gives every trade a starting catalogue, not just an accounts list", () => {
    for (const [niche, pack] of Object.entries(PACKS)) {
      expect(pack.starterCatalogue.length, `${niche} has no starter catalogue`).toBeGreaterThan(1);
      for (const line of pack.starterCatalogue) {
        expect(line.name.length).toBeGreaterThan(2);
        expect(line.unit.length).toBeGreaterThan(0);
      }
    }
  });

  it("seeds the trade's accounts and lines at zero, and says why they are zero", async () => {
    const result = await applyPack(tenantId);
    expect(result.label).toBe(packFor("SERVICES").label);
    expect(result.accounts).toBeGreaterThan(0);
    expect(result.catalogue).toBeGreaterThan(0);

    const items = await prisma.item.findMany({ where: { tenantId }, select: { name: true, unitPriceCents: true, unit: true } });
    expect(items.length).toBe(result.catalogue);
    // A made-up price that reaches a customer is worse than an empty one.
    for (const item of items) expect(item.unitPriceCents).toBe(0);
    expect(items.some((item) => item.name === "Call-out")).toBe(true);
  });

  it("is safe to run twice", async () => {
    await applyPack(tenantId);
    const again = await applyPack(tenantId);
    expect(again.accounts).toBe(0);
    expect(again.catalogue).toBe(0);
  });

  it("does not overwrite something the owner already added", async () => {
    await prisma.item.create({ data: { tenantId, name: "Call-out", unitPriceCents: 45_000 } });
    await applyPack(tenantId);
    const theirs = await prisma.item.findFirst({ where: { tenantId, name: "Call-out" } });
    expect(theirs!.unitPriceCents).toBe(45_000);
    expect(await prisma.item.count({ where: { tenantId, name: "Call-out" } })).toBe(1);
  });
});

describe("reading a business's own website", () => {
  it("will not be pointed at anything inside the network", () => {
    // The one that matters most: the cloud metadata endpoint, identical on
    // AWS, GCP and Azure, which hands out the server's own credentials.
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("10.1.2.3")).toBe(true);
    expect(isPrivateHost("172.16.4.5")).toBe(true);
    expect(isPrivateHost("172.32.4.5")).toBe(false);
    expect(isPrivateHost("192.168.0.1")).toBe(true);
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("db.internal")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("skynatflow.com")).toBe(false);
  });

  it("refuses a scheme that is not the web at all", () => {
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("gopher://example.com")).toBeNull();
    expect(safeUrl("http://192.168.1.1/admin")).toBeNull();
    expect(safeUrl("https://example.com:2375")).toBeNull();
    // And is forgiving about how somebody types a real one.
    expect(safeUrl("kganya.co.za")?.hostname).toBe("kganya.co.za");
    expect(safeUrl("  https://Kganya.co.za/contact ")?.hostname).toBe("kganya.co.za");
  });

  it("refuses without a network call, so a bad address never becomes a request", async () => {
    const result = await scanWebsite("http://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not look like a website address/i);
  });

  it("pulls the facts out of a real-shaped page, and says where each came from", () => {
    const html = `
      <html><head>
        <title>Kganya Plumbing | 24 hour emergency plumbers in Benoni</title>
        <meta name="description" content="Blocked drains, burst geysers and leak detection across the East Rand." />
      </head><body>
        <h2>Geyser installation</h2>
        <h2>Drain cleaning</h2>
        <h3>Leak detection</h3>
        <a href="tel:+27 11 555 1234">Call us</a>
        <a href="mailto:info@kganya.co.za">Email</a>
        <address>14 Rothsay Street, Benoni, 1501</address>
        <footer>VAT Reg No: 4123456784 &middot; Reg 2019/123456/07</footer>
      </body></html>`;

    const facts = readFacts(html, "https://kganya.co.za");
    // The title is "Name | tagline"; only the name belongs on an invoice.
    expect(facts.name?.value).toBe("Kganya Plumbing");
    expect(facts.name?.where).toMatch(/title/);
    expect(facts.description?.value).toMatch(/Blocked drains/);
    expect(facts.phone?.value).toContain("555");
    expect(facts.email?.value).toBe("info@kganya.co.za");
    expect(facts.address?.value).toMatch(/Rothsay/);
    expect(facts.vatNumber?.value).toBe("4123456784");
    expect(facts.registrationNumber?.value).toBe("2019/123456/07");
    expect(facts.services).toContain("Drain cleaning");
  });

  it("leaves a no-reply address alone, because it helps nobody", () => {
    const facts = readFacts('<a href="mailto:no-reply@mailer.example">x</a>', "https://x.test");
    expect(facts.email).toBeNull();
    expect(facts.notes.join(" ")).toMatch(/no email address found/i);
  });

  it("says what it could not find rather than leaving a silent blank", () => {
    const facts = readFacts("<html><body><div>Loading…</div></body></html>", "https://x.test");
    expect(facts.notes.join(" ")).toMatch(/builds itself in the browser/i);
  });
});

describe("bringing data in", () => {
  it("knows the systems a South African business is actually leaving", () => {
    for (const key of ["zoho", "quickbooks", "xero", "sage", "generic"]) {
      expect(IMPORT_PRESETS[key], `${key} preset missing`).toBeTruthy();
    }
    expect(IMPORT_PRESETS.sage.label).toMatch(/Pastel/);
  });

  it("says what would land before anything does", () => {
    const result = preflight({
      target: "customers",
      headers: ["Name", "Phone", "Loyalty Points"],
      mappedColumns: ["Name", "Phone"],
      records: [
        { name: "Naledi Trading", phone: "0835551234" },
        { name: "Bokamoso Works", phone: "0825559876" },
      ],
      existing: new Set(["bokamoso works"]),
    });

    expect(result.wouldCreate).toBe(1);
    expect(result.wouldMatch).toBe(1);
    expect(result.ignoredColumns).toEqual(["Loyalty Points"]);
    expect(preflightSentence(result, "customers")).toMatch(/1 new customers, 1 already here/);
  });

  it("catches a file that would create the same customer twice", () => {
    const result = preflight({
      target: "customers",
      headers: ["Name"],
      mappedColumns: ["Name"],
      records: [{ name: "Naledi Trading" }, { name: "naledi trading" }],
      existing: new Set(),
    });
    expect(result.wouldCreate).toBe(1);
    expect(result.wouldSkip[0].why).toMatch(/more than once in this file/i);
  });

  it("names an amount column that is not amounts", () => {
    const result = preflight({
      target: "invoices",
      headers: ["Invoice", "Total", "Date"],
      mappedColumns: ["Invoice", "Total", "Date"],
      records: [
        { reference: "INV-1", amountCents: "paid in full", date: "2026-01-01" },
        { reference: "INV-2", amountCents: "R1 200.00", date: "2026-01-02" },
      ],
      existing: new Set(),
    });
    expect(result.warnings.join(" ")).toMatch(/cannot be read as money/i);
    expect(result.warnings.join(" ")).toMatch(/come in at zero/i);
  });

  it("skips a row with nothing to identify it, and says which row", () => {
    const result = preflight({
      target: "customers",
      headers: ["Name"],
      mappedColumns: ["Name"],
      records: [{ name: "" }, { name: "Real Customer" }],
      existing: new Set(),
    });
    // Row 2, because a spreadsheet counts the header as row 1.
    expect(result.wouldSkip[0].row).toBe(2);
    expect(result.wouldCreate).toBe(1);
  });
});

describe("what a workspace may use", () => {
  it("starts comfortably inside everything", async () => {
    const rows = await usage(tenantId);
    expect(rows).toHaveLength(METERS.length);
    for (const row of rows) {
      expect(row.used).toBe(0);
      expect(row.standing).toBe("fine");
    }
    expect(await usageSummary(tenantId)).toMatch(/comfortably inside/i);
  });

  it("lets unattended work run while there is allowance left", async () => {
    const verdict = await mayRunUnattended(tenantId, "ai-calls");
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("describes every meter in words somebody can act on", () => {
    for (const meter of METERS) {
      expect(meter.why.length).toBeGreaterThan(20);
      expect(meter.label).not.toMatch(/[a-z][A-Z]/);
      expect(meter.monthlyAllowance).toBeGreaterThan(0);
    }
  });
});

describe("is it working", () => {
  it("runs real checks and never reports a bare boolean", async () => {
    const report = await status();
    expect(report.checks.length).toBeGreaterThanOrEqual(3);
    for (const check of report.checks) {
      expect(check.detail.length, `${check.key} has no explanation`).toBeGreaterThan(15);
      // Worded for somebody who does not know what a database is.
      expect(check.label).not.toMatch(/database|postgres|prisma/i);
    }
    // The database check actually queried, so it has a duration.
    const database = report.checks.find((check) => check.key === "database")!;
    expect(database.health).toBe("working");
    expect(database.ms).not.toBeNull();
  });

  it("does not go red because something is simply not switched on", async () => {
    // The schedule check reads the last scheduled run, so one is made here —
    // otherwise this test would pass or fail depending on how long ago some
    // other test happened to run the tick.
    await prisma.agentRun.create({ data: { tenantId, trigger: "SCHEDULE", input: "tick" } });

    const report = await status();
    // Mail and the model are not configured in a test run, so both come back
    // "unknown". An unconfigured feature must never make the page look
    // broken — a permanently red status page is a useless one.
    expect(report.checks.some((check) => check.health === "unknown")).toBe(true);
    expect(report.overall).not.toBe("down");
    expect(report.headline).not.toMatch(/broken/i);

    await prisma.agentRun.deleteMany({ where: { tenantId } });
  });
});
