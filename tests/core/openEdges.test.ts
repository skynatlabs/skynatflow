// The parts of this that touch the world outside the product.
//
// The automation catalogue, the accountant's file, the signing record, the
// forms on somebody's own website and the branding on top of all of it. The
// properties that matter here are mostly about honesty: a file that silently
// drops rows, a comparison that quietly changes shape, or a signing record
// that says "signed" about a document somebody edited afterwards are all
// worse than no feature at all.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { catalogue, poll, sampleFor, TRIGGERS } from "../../src/lib/api/automation";
import { exportCosts, exportInvoices, exportTrialBalance, PACKAGES } from "../../src/lib/export/accounting";
import { awaitingSignature, maskIp, noteSigningEvent, shortDevice, signingCertificate } from "../../src/lib/core/signing";
import { allowedHostsFrom, framingPolicy, snippetFor, widgetReadiness, WIDGETS } from "../../src/lib/core/embeds";
import { claimDomain, getBranding, normaliseAccent, normaliseDomain, readableOn, setBranding } from "../../src/lib/core/whiteLabel";
import { backupStatus, chooseProvider, fileNameFor, folderFor, whatWouldBeCopied } from "../../src/lib/core/documentBackup";
import { createAgreement, sendAgreement, signAgreement } from "../../src/lib/core/agreements";

const DAY = 86_400_000;

let tenantId: string;
let partyId: string;
let itemId: string;

beforeEach(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Kganya Plumbing", niche: "SERVICES", currency: "ZAR" } });
  tenantId = tenant.id;
  partyId = (
    await prisma.party.create({
      data: { tenantId, name: "Naledi Mokoena", companyName: "Mokoena Holdings", role: "CUSTOMER", email: "naledi@example.com", phone: "0835551234" },
    })
  ).id;
  itemId = (await prisma.item.create({ data: { tenantId, name: "Geyser install", unitPriceCents: 450_000, costCents: 300_000, taxRatePercent: 15 } })).id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.paymentCheckout.deleteMany({ where: { tenantId } });
  await prisma.agreement.deleteMany({ where: { tenantId } });
  await prisma.journalLine.deleteMany({ where: { entry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.leadForm.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

async function invoice(amountCents: number, daysAgo: number, status: "SENT" | "DRAFT" = "SENT") {
  return prisma.transaction.create({
    data: {
      tenantId,
      partyId,
      type: "INVOICE",
      status,
      amountCents,
      externalRef: `INV-${1000 + daysAgo}`,
      createdAt: new Date(Date.now() - daysAgo * DAY),
      dueAt: new Date(Date.now() - (daysAgo - 30) * DAY),
    },
  });
}

async function quote(amountCents: number, daysAgo: number) {
  return prisma.transaction.create({
    data: {
      tenantId,
      partyId,
      type: "QUOTE",
      status: "SENT",
      amountCents,
      createdAt: new Date(Date.now() - daysAgo * DAY),
    },
  });
}

describe("what other systems can subscribe to", () => {
  it("offers a sample of every trigger without any data existing", () => {
    for (const trigger of TRIGGERS) {
      const sample = sampleFor(trigger.key);
      expect(sample, `${trigger.key} needs a sample`).toBeTruthy();
      // The sample is what an automation builder maps fields from, so it has
      // to carry every field a real one would.
      expect(Object.keys(sample!).length).toBeGreaterThan(2);
    }
  });

  it("describes itself well enough for somebody to build against it", () => {
    const shape = catalogue();
    expect(shape.triggers.length).toBeGreaterThanOrEqual(5);
    expect(shape.actions.length).toBeGreaterThanOrEqual(3);
    for (const trigger of shape.triggers) {
      expect(trigger.label).not.toMatch(/[a-z][A-Z]/);
      expect(trigger.description.length).toBeGreaterThan(10);
    }
  });

  it("returns newest first, and treats `since` as strictly after", async () => {
    const older = await quote(100_000, 10);
    const newer = await quote(200_000, 2);

    // Newest first, because Zapier and Make stop at the first id they have
    // already seen. A list that reorders itself makes them replay or skip.
    const all = await poll({ tenantId, trigger: "new_quote", limit: 10 });
    expect(all.map((row) => row.id)).toEqual([newer.id, older.id]);

    const since = await poll({ tenantId, trigger: "new_quote", since: new Date(Date.now() - 5 * DAY), limit: 10 });
    const ids = since.map((row) => row.id);
    expect(ids).toContain(newer.id);
    expect(ids).not.toContain(older.id);
  });

  it("refuses a trigger it does not have rather than answering with an empty list", async () => {
    // An empty list reads as "nothing happened yet", which is how somebody
    // spends an afternoon debugging a typo in their own automation.
    await expect(poll({ tenantId, trigger: "definitely_not_a_trigger", limit: 5 })).rejects.toThrow(/no such trigger/i);
  });
});

describe("the file the accountant imports", () => {
  it("writes one row per line, in the columns that package actually wants", async () => {
    const doc = await invoice(900_000, 5);
    await prisma.transactionLine.create({ data: { transactionId: doc.id, itemId, quantity: 2, unitPriceCents: 450_000, taxRatePercent: 15, sortOrder: 0 } });

    const xero = await exportInvoices({ tenantId, pkg: "xero", from: new Date(Date.now() - 30 * DAY), to: new Date() });
    expect(xero.rows).toBe(1);
    expect(xero.csv.split("\r\n")[0]).toContain("ContactName");
    expect(xero.csv).toContain("Mokoena Holdings");
    // Units, not cents — an accountant importing 450000 books four and a half
    // million rand.
    expect(xero.csv).toContain("4500.00");

    const sage = await exportInvoices({ tenantId, pkg: "sage", from: new Date(Date.now() - 30 * DAY), to: new Date() });
    expect(sage.csv.split("\r\n")[0]).toContain("Document Number");
    // Sage wants day first. Getting this wrong is the usual failure.
    expect(sage.csv).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("leaves drafts out, and says so rather than quietly dropping them", async () => {
    await invoice(100_000, 3, "DRAFT");
    const result = await exportInvoices({ tenantId, pkg: "generic", from: new Date(Date.now() - 30 * DAY), to: new Date() });
    expect(result.rows).toBe(0);
    expect(result.notes.join(" ")).toMatch(/drafts.*not included/i);
  });

  it("exports an invoice with no lines at its own total rather than losing it", async () => {
    await invoice(250_000, 4);
    const result = await exportInvoices({ tenantId, pkg: "generic", from: new Date(Date.now() - 30 * DAY), to: new Date() });
    expect(result.rows).toBe(1);
    expect(result.csv).toContain("2500.00");
    expect(result.notes.join(" ")).toMatch(/no line items/i);
  });

  it("names the costs nobody has coded, because that is the accountant's afternoon", async () => {
    const membership = await prisma.membership.findFirst({ where: { tenantId } });
    await prisma.expense.create({
      data: {
        tenantId,
        submittedById: membership?.id ?? "seed",
        descriptionText: "Copper pipe",
        amountCents: 120_000,
        taxCents: 15_652,
        status: "APPROVED",
        spentOn: new Date(Date.now() - 3 * DAY),
      },
    });

    const result = await exportCosts({ tenantId, pkg: "quickbooks", from: new Date(Date.now() - 30 * DAY), to: new Date() });
    expect(result.rows).toBe(1);
    expect(result.notes.join(" ")).toMatch(/not coded to an account/i);
    // Net, tax and total have to add up or the import is rejected.
    const row = result.csv.split("\r\n")[1].split(",");
    const header = result.csv.split("\r\n")[0].split(",");
    const amount = Number(row[header.indexOf("Amount")]);
    const tax = Number(row[header.indexOf("Tax")]);
    const total = Number(row[header.indexOf("Total")]);
    expect(Number((amount + tax).toFixed(2))).toBe(total);
  });

  it("says out loud when a trial balance does not balance", async () => {
    const bank = await prisma.account.create({ data: { tenantId, code: "1000", name: "Bank", type: "ASSET" } });
    const sales = await prisma.account.create({ data: { tenantId, code: "4000", name: "Sales", type: "INCOME" } });
    const entry = await prisma.journalEntry.create({ data: { tenantId, entryDate: new Date(Date.now() - 2 * DAY), memo: "Deliberately lopsided" } });
    await prisma.journalLine.create({ data: { entryId: entry.id, accountId: bank.id, debitCents: 100_000 } });
    await prisma.journalLine.create({ data: { entryId: entry.id, accountId: sales.id, creditCents: 90_000 } });

    const result = await exportTrialBalance({ tenantId, from: new Date(Date.now() - 30 * DAY), to: new Date() });
    expect(result.rows).toBe(2);
    expect(result.notes.join(" ")).toMatch(/do not agree/i);
    expect(result.notes.join(" ")).toContain("100.00");
  });

  it("gives every package an instruction somebody can follow", () => {
    for (const pkg of PACKAGES) {
      expect(pkg.how.length).toBeGreaterThan(20);
      expect(pkg.liveSync.length).toBeGreaterThan(0);
    }
  });
});

describe("the signing record", () => {
  it("keeps enough to place a signature and not enough to track somebody", () => {
    expect(maskIp("41.13.22.9")).toBe("41.13.x.x");
    expect(maskIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:…");
    expect(maskIp("nonsense")).toBe("unknown");
    expect(shortDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Version/17.0 Safari/604")).toBe("Safari on iPhone or iPad");
  });

  it("builds a history from what actually happened, in order", async () => {
    const agreement = await createAgreement({
      tenantId,
      partyId,
      templateKey: "service",
      valueCents: 500_000,
    });

    await noteSigningEvent({ tenantId, kind: "agreement", documentId: agreement.id, event: "sent", actor: { type: "user", name: "Thabo" } });
    await noteSigningEvent({
      tenantId,
      kind: "agreement",
      documentId: agreement.id,
      event: "opened",
      actor: { type: "user", name: "Mokoena Holdings" },
      ip: "41.13.22.9",
      userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit Chrome/120 Safari/537",
    });

    const certificate = await signingCertificate({ tenantId, kind: "agreement", documentId: agreement.id });
    expect(certificate).not.toBeNull();
    expect(certificate!.history.map((line) => line.what)).toEqual(["Sent to the customer", "Opened by the customer"]);
    expect(certificate!.history[1].where).toBe("41.13.x.x");
    expect(certificate!.history[1].device).toBe("Chrome on a Mac");
    // The claim is stated rather than implied.
    expect(certificate!.standing.join(" ")).toMatch(/not a notarised/i);
  });

  it("notices when a signed document has been edited since", async () => {
    const agreement = await createAgreement({ tenantId, partyId, templateKey: "service", valueCents: 500_000 });
    await sendAgreement(tenantId, agreement.id);
    await signAgreement({
      agreementId: agreement.id,
      partyId,
      signerName: "Naledi Mokoena",
      signatureDataUrl: "data:image/png;base64,AAAA",
    });

    const before = await signingCertificate({ tenantId, kind: "agreement", documentId: agreement.id });
    expect(before!.intact).toBe(true);

    // Somebody changes a clause after the fact. This is the exact thing the
    // fingerprint exists to catch.
    await prisma.agreement.update({
      where: { id: agreement.id },
      data: { clauses: [{ heading: "Payment", body: "Payable within 90 days, obviously." }] },
    });

    const after = await signingCertificate({ tenantId, kind: "agreement", documentId: agreement.id });
    expect(after!.intact).toBe(false);
  });

  it("lists what is waiting oldest first, and calls three weeks what it is", async () => {
    const stale = await createAgreement({ tenantId, partyId, templateKey: "service", valueCents: 100_000 });
    const fresh = await createAgreement({ tenantId, partyId, templateKey: "service", valueCents: 200_000 });
    await sendAgreement(tenantId, stale.id);
    await sendAgreement(tenantId, fresh.id);
    await prisma.agreement.update({ where: { id: stale.id }, data: { sentAt: new Date(Date.now() - 30 * DAY) } });

    const waiting = await awaitingSignature(tenantId);
    expect(waiting[0].reference).toBe(stale.number);
    expect(waiting[0].waitingDays).toBeGreaterThanOrEqual(29);
    expect(waiting[0].note).toMatch(/quiet|no that nobody said/i);
  });

  it("finds nothing for a document in another workspace, rather than leaking it", async () => {
    const other = await prisma.tenant.create({ data: { name: "Somebody Else", currency: "ZAR" } });
    const agreement = await createAgreement({ tenantId, partyId, templateKey: "service", valueCents: 100_000 });
    const certificate = await signingCertificate({ tenantId: other.id, kind: "agreement", documentId: agreement.id });
    expect(certificate).toBeNull();
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

describe("forms on somebody's own website", () => {
  it("gives a snippet that names this workspace and this widget, not a placeholder", () => {
    const { plain, resizing } = snippetFor({ origin: "https://app.example.com", tenantId, kind: "enquiry" });
    expect(plain).toContain(`https://app.example.com/embed/${tenantId}/enquiry`);
    expect(plain).toContain("<iframe");
    expect(resizing).toContain("/embed.js");
    expect(resizing).toContain(tenantId);
  });

  it("refuses to offer a widget that would render an empty box", async () => {
    const rows = await widgetReadiness(tenantId);
    const booking = rows.find((row) => row.kind === "booking")!;
    expect(booking.ready).toBe(false);
    expect(booking.blocker).toMatch(/bookings are switched off/i);

    const pay = rows.find((row) => row.kind === "pay")!;
    expect(pay.ready).toBe(false);
    expect(pay.blocker).toMatch(/payment provider/i);
  });

  it("describes every widget in words somebody choosing one can use", () => {
    for (const widget of WIDGETS) {
      expect(widget.label).not.toMatch(/[a-z][A-Z]/);
      expect(widget.purpose.length).toBeGreaterThan(20);
    }
  });

  it("leaves framing open until a business names its sites, then pins it", () => {
    expect(framingPolicy([])).toBe("frame-ancestors *");
    expect(framingPolicy(["kganya.co.za"])).toBe("frame-ancestors 'self' https://kganya.co.za");
    expect(allowedHostsFrom("https://kganya.co.za/contact, www.kganya.co.za  nonsense")).toEqual([
      "kganya.co.za",
      "www.kganya.co.za",
    ]);
  });
});

describe("what a customer sees", () => {
  it("refuses a colour it cannot actually paint with", async () => {
    expect(normaliseAccent("1d4ed8")).toBe("#1d4ed8");
    expect(normaliseAccent("#1D4ED8")).toBe("#1d4ed8");
    expect(normaliseAccent("cornflower")).toBeNull();
    await expect(setBranding(tenantId, { accent: "cornflower" })).rejects.toThrow(/six-digit hex/i);
  });

  it("flips the text on a colour too bright to put white on", () => {
    expect(readableOn("#111111")).toBe("#ffffff");
    expect(readableOn("#ffe600")).toBe("#111111");
    expect(readableOn("#1d4ed8")).toBe("#ffffff");
  });

  it("takes a domain as a hostname however somebody types it", async () => {
    expect(normaliseDomain("https://Portal.Kganya.co.za/anything")).toBe("portal.kganya.co.za");
    expect(normaliseDomain("not a domain")).toBeNull();

    const claimed = await claimDomain(tenantId, "portal.kganya.co.za ");
    expect(claimed.domain).toBe("portal.kganya.co.za");
    // Claiming is not verifying, and the instructions are the exact records.
    expect(claimed.records).toHaveLength(2);
    expect(claimed.records[0].type).toBe("CNAME");

    const branding = await getBranding(tenantId);
    expect(branding.customDomain).toBe("portal.kganya.co.za");
    expect(branding.domainVerified).toBe(false);
  });

  it("shows the platform's name until somebody turns it off", async () => {
    const before = await getBranding(tenantId);
    expect(before.showsPlatform).toBe(true);
    await setBranding(tenantId, { hidePlatformBranding: true });
    const after = await getBranding(tenantId);
    expect(after.showsPlatform).toBe(false);
  });
});

describe("a copy in the owner's own drive", () => {
  it("sorts by kind and then by year, because that is how somebody looks", () => {
    expect(folderFor("Kganya Plumbing", "invoices", new Date("2026-03-04"))).toBe("Kganya Plumbing/Invoices/2026");
    // A slash in a business name would make a folder nobody meant.
    expect(folderFor("Kganya / Plumbing", "invoices", new Date("2026-03-04"))).toBe("Kganya - Plumbing/Invoices/2026");
    expect(fileNameFor({ reference: "INV-1042", customer: "Mokoena Holdings", when: new Date("2026-03-04") })).toBe(
      "INV-1042 — Mokoena Holdings — 2026-03-04.pdf",
    );
  });

  it("says what is missing rather than offering a button that does nothing", async () => {
    const off = await backupStatus(tenantId);
    expect(off.connected).toBe(false);
    expect(off.notes.join(" ")).toMatch(/not connected on this deployment/i);

    await chooseProvider(tenantId, "google_drive");
    const chosen = await backupStatus(tenantId);
    expect(chosen.provider).toBe("google_drive");
    expect(chosen.connected).toBe(false);
    expect(chosen.summary).toMatch(/Google Cloud project/i);
  });

  it("counts what a first copy would actually contain before anybody connects anything", async () => {
    const empty = await whatWouldBeCopied(tenantId);
    expect(empty.total).toBe(0);
    expect(empty.summary).toMatch(/nothing to copy yet/i);

    await invoice(100_000, 2);
    const some = await whatWouldBeCopied(tenantId);
    expect(some.total).toBe(1);
    expect(some.summary).toMatch(/1 document would be copied/i);
    expect(some.counts.find((row) => row.kind === "invoices")!.folder).toContain("Kganya Plumbing/Invoices/");
  });
});
