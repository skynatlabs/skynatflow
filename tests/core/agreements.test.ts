// Proposals and contracts.
//
// The properties that matter are the ones that make a signature worth
// anything: a signed document does not change, the hash notices if somebody
// changes it anyway, and one customer's portal link can never sign another
// customer's contract. Plus the plumbing that makes the library usable —
// placeholders actually filled, numbers that do not collide.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  AGREEMENT_TEMPLATES,
  acceptanceHashFor,
  agreementPipeline,
  createAgreement,
  declineAgreement,
  deleteDraftAgreement,
  expireStaleAgreements,
  fillClauses,
  getAgreement,
  listAgreements,
  nextAgreementNumber,
  parseClauses,
  sendAgreement,
  signAgreement,
  signatureStillMatches,
  updateAgreement,
} from "../../src/lib/core/agreements";

const PEN =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let tenantId: string;
let otherTenantId: string;
let partyId: string;
let otherPartyId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Kagiso Plumbing", niche: "SERVICES", currency: "ZAR" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  const party = await prisma.party.create({
    data: { tenantId, name: "Jabu Ndlovu", companyName: "Ndlovu Trading CC", role: "CUSTOMER" },
  });
  partyId = party.id;
  const otherParty = await prisma.party.create({ data: { tenantId: otherTenantId, name: "Thabo Stores", role: "CUSTOMER" } });
  otherPartyId = otherParty.id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.agreement.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
});

describe("the library", () => {
  it("fills every placeholder it uses, and leaves none behind", () => {
    for (const template of AGREEMENT_TEMPLATES) {
      const filled = fillClauses(template.clauses, {
        business: "Kagiso Plumbing",
        customer: "Ndlovu Trading CC",
        value: "R4 500,00 a month",
        starts: "1 October 2026",
        ends: "30 September 2027",
      });
      const text = filled.map((c) => `${c.heading}\n${c.body}`).join("\n");
      expect(text, `${template.key} left a placeholder in`).not.toMatch(/\{[a-z]+\}/);
      expect(filled.length).toBe(template.clauses.length);
    }
  });

  it("writes a document from a template with the customer and the money already in it", async () => {
    const agreement = await createAgreement({
      tenantId,
      partyId,
      templateKey: "retainer",
      valueCents: 450_000,
      recurrence: "monthly",
      startsAt: new Date("2026-10-01"),
      endsAt: new Date("2027-09-30"),
    });

    expect(agreement.number).toBe("AG-0001");
    expect(agreement.status).toBe("DRAFT");
    expect(agreement.kind).toBe("RETAINER");
    expect(agreement.title).toContain("Ndlovu Trading CC");
    expect(agreement.currency).toBe("ZAR");

    const clauses = parseClauses(agreement.clauses);
    const text = clauses.map((c) => c.body).join("\n");
    expect(text).toContain("Ndlovu Trading CC");
    expect(text.replace(/ /g, " ")).toContain("R4 500,00 a month");
  });

  it("numbers them in order and never reuses one", async () => {
    await createAgreement({ tenantId, partyId, templateKey: "nda" });
    await createAgreement({ tenantId, partyId, templateKey: "proposal" });
    expect(await nextAgreementNumber(tenantId)).toBe("AG-0003");
    // Another workspace starts at one of its own.
    expect(await nextAgreementNumber(otherTenantId)).toBe("AG-0001");
  });

  it("refuses a customer or a template that is not there", async () => {
    await expect(createAgreement({ tenantId, partyId: otherPartyId, templateKey: "nda" })).rejects.toThrow(/not in this workspace/i);
    await expect(createAgreement({ tenantId, partyId, templateKey: "nonsense" })).rejects.toThrow(/no template/i);
  });
});

describe("signing", () => {
  it("cannot be signed before it is sent, and cannot be sent empty", async () => {
    const blank = await createAgreement({ tenantId, partyId });
    await expect(sendAgreement(tenantId, blank.id)).rejects.toThrow(/nothing in this document/i);

    const agreement = await createAgreement({ tenantId, partyId, templateKey: "service" });
    await expect(
      signAgreement({ agreementId: agreement.id, partyId, signerName: "Jabu", signatureDataUrl: PEN })
    ).rejects.toThrow(/not been sent/i);
  });

  it("records who signed, when, and a hash of what they signed", async () => {
    const agreement = await createAgreement({ tenantId, partyId, templateKey: "service", valueCents: 1_200_000 });
    await sendAgreement(tenantId, agreement.id);

    const signed = await signAgreement({
      agreementId: agreement.id,
      partyId,
      signerName: "  Jabu Ndlovu ",
      signatureDataUrl: PEN,
      signerIp: "196.25.1.1",
    });

    expect(signed.status).toBe("SIGNED");
    expect(signed.signerName).toBe("Jabu Ndlovu");
    expect(signed.signerIp).toBe("196.25.1.1");
    expect(signed.acceptanceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signatureStillMatches(signed)).toBe(true);

    // Signing twice is not a thing.
    await expect(
      signAgreement({ agreementId: agreement.id, partyId, signerName: "Jabu", signatureDataUrl: PEN })
    ).rejects.toThrow(/already been signed/i);
  });

  it("wants a name and a signature, not one or the other", async () => {
    const agreement = await createAgreement({ tenantId, partyId, templateKey: "nda" });
    await sendAgreement(tenantId, agreement.id);

    await expect(
      signAgreement({ agreementId: agreement.id, partyId, signerName: "   ", signatureDataUrl: PEN })
    ).rejects.toThrow(/type your name/i);
    await expect(
      signAgreement({ agreementId: agreement.id, partyId, signerName: "Jabu", signatureDataUrl: "not-an-image" })
    ).rejects.toThrow(/signature is needed/i);
  });

  it("never lets one customer's link sign another customer's contract", async () => {
    const agreement = await createAgreement({ tenantId, partyId, templateKey: "service" });
    await sendAgreement(tenantId, agreement.id);

    await expect(
      signAgreement({ agreementId: agreement.id, partyId: otherPartyId, signerName: "Thabo", signatureDataUrl: PEN })
    ).rejects.toThrow(/does not belong to this link/i);
    await expect(declineAgreement({ agreementId: agreement.id, partyId: otherPartyId })).rejects.toThrow(
      /does not belong to this link/i
    );
  });

  it("will not let a signed document be edited or deleted", async () => {
    const agreement = await createAgreement({ tenantId, partyId, templateKey: "service" });
    await sendAgreement(tenantId, agreement.id);
    await signAgreement({ agreementId: agreement.id, partyId, signerName: "Jabu Ndlovu", signatureDataUrl: PEN });

    await expect(updateAgreement(tenantId, agreement.id, { title: "Something else" })).rejects.toThrow(/has been signed/i);
    await expect(deleteDraftAgreement(tenantId, agreement.id)).rejects.toThrow(/only a draft/i);
  });

  it("notices when the words no longer match the signature", async () => {
    const agreement = await createAgreement({ tenantId, partyId, templateKey: "nda", valueCents: null });
    await sendAgreement(tenantId, agreement.id);
    const signed = await signAgreement({ agreementId: agreement.id, partyId, signerName: "Jabu Ndlovu", signatureDataUrl: PEN });
    expect(signatureStillMatches(signed)).toBe(true);

    // Changed behind the app's back, the way an attacker or a bad migration
    // would. The hash is what makes that detectable rather than invisible.
    const tampered = await prisma.agreement.update({
      where: { id: agreement.id },
      data: { clauses: [{ heading: "Payment", body: "Ten times as much." }] },
    });
    expect(signatureStillMatches(tampered)).toBe(false);

    // And nothing is claimed about a document nobody has signed.
    const unsigned = await createAgreement({ tenantId, partyId, templateKey: "nda" });
    expect(signatureStillMatches(unsigned)).toBeNull();
  });

  it("hashes the same document the same way twice, and a different one differently", () => {
    const clauses = [{ heading: "The work", body: "Two visits a year." }];
    const signedAt = new Date("2026-09-16T08:00:00Z");
    const a = acceptanceHashFor({ clauses, valueCents: 450_000, signerName: "Jabu Ndlovu", signedAt });
    const b = acceptanceHashFor({ clauses, valueCents: 450_000, signerName: "  jabu ndlovu  ", signedAt });
    const c = acceptanceHashFor({ clauses, valueCents: 450_001, signerName: "Jabu Ndlovu", signedAt });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("the pipeline", () => {
  it("counts what is waiting, what is signed, and what is still a draft", async () => {
    const waiting = await createAgreement({ tenantId, partyId, templateKey: "proposal", valueCents: 500_000 });
    await sendAgreement(tenantId, waiting.id);
    const done = await createAgreement({ tenantId, partyId, templateKey: "service", valueCents: 1_000_000 });
    await sendAgreement(tenantId, done.id);
    await signAgreement({ agreementId: done.id, partyId, signerName: "Jabu Ndlovu", signatureDataUrl: PEN });
    await createAgreement({ tenantId, partyId, templateKey: "nda" });

    const pipeline = await agreementPipeline(tenantId);
    expect(pipeline).toMatchObject({
      awaitingSignature: 1,
      awaitingValueCents: 500_000,
      signed: 1,
      signedValueCents: 1_000_000,
      drafts: 1,
    });

    // Another workspace's documents are never in it.
    expect(await listAgreements(otherTenantId)).toHaveLength(0);
  });

  it("expires a proposal that has gone stale, and leaves a live one alone", async () => {
    const stale = await createAgreement({
      tenantId,
      partyId,
      templateKey: "proposal",
      validUntil: new Date(Date.now() - 86_400_000),
    });
    const live = await createAgreement({
      tenantId,
      partyId,
      templateKey: "proposal",
      validUntil: new Date(Date.now() + 86_400_000),
    });
    const forever = await createAgreement({ tenantId, partyId, templateKey: "service" });
    for (const a of [stale, live, forever]) await sendAgreement(tenantId, a.id);

    expect(await expireStaleAgreements(tenantId)).toBe(1);
    expect((await getAgreement(tenantId, stale.id))!.status).toBe("EXPIRED");
    expect((await getAgreement(tenantId, live.id))!.status).toBe("SENT");
    expect((await getAgreement(tenantId, forever.id))!.status).toBe("SENT");
  });

  it("will not read or change another workspace's document", async () => {
    const agreement = await createAgreement({ tenantId, partyId, templateKey: "nda" });
    expect(await getAgreement(otherTenantId, agreement.id)).toBeNull();
    await expect(updateAgreement(otherTenantId, agreement.id, { title: "Mine now" })).rejects.toThrow(/not in this workspace/i);
    await expect(sendAgreement(otherTenantId, agreement.id)).rejects.toThrow(/not in this workspace/i);
    await expect(deleteDraftAgreement(otherTenantId, agreement.id)).rejects.toThrow(/not in this workspace/i);
  });
});
