// On a phone.
//
// Two things here are worth defending with tests. The push encryption, because
// every one of its failures is silent — a wrong signature length or a wrong
// key derivation produces a 401 from a push service and no error anywhere
// somebody will see. And field mode's insistence that every action goes
// through the queue, because a write that sometimes queues and sometimes does
// not has two orderings, and the bug that produces only appears on a bad day
// at a customer's site.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createECDH, createPublicKey, createVerify, randomBytes } from "crypto";
import { prisma } from "../../src/lib/db";
import { encrypt, pushConfigured, pushStatus, subscribe, unsubscribe, vapidHeader } from "../../src/lib/core/push";
import { directionsTo, recordInTheField, todayInTheField } from "../../src/lib/core/fieldMode";

let tenantId: string;
let membershipId: string;
let userId: string;
let partyId: string;

const DAY = 86_400_000;

function b64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A subscription of the shape a browser actually hands over. */
function fakeSubscription() {
  const client = createECDH("prime256v1");
  client.generateKeys();
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    p256dh: b64url(client.getPublicKey()),
    auth: b64url(randomBytes(16)),
  };
}

beforeEach(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Roof & Gutter", niche: "SERVICES", currency: "ZAR" } });
  tenantId = tenant.id;

  const user = await prisma.user.create({ data: { email: `apps-${tenant.id}@example.com`, name: "Sipho Ndlovu" } });
  userId = user.id;
  membershipId = (await prisma.membership.create({ data: { tenantId, userId, role: "TECHNICIAN" } })).id;
  partyId = (await prisma.party.create({ data: { tenantId, name: "Mrs Khumalo", role: "CUSTOMER", phone: "0835551234", addressLine: "9 Oak Avenue, Benoni" } })).id;
});

afterEach(async () => {
  await prisma.pushSubscription.deleteMany({ where: { tenantId } });
  await prisma.offlineChange.deleteMany({ where: { tenantId } });
  await prisma.timeEntry.deleteMany({ where: { tenantId } });
  await prisma.jobCard.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("telling somebody when they are not looking", () => {
  it("signs a VAPID token a push service would accept", () => {
    const keys = createECDH("prime256v1");
    keys.generateKeys();
    const publicKey = b64url(keys.getPublicKey());
    const privateKey = b64url(keys.getPrivateKey());

    const header = vapidHeader("https://fcm.googleapis.com/fcm/send/abc", "mailto:hello@example.com", publicKey, privateKey);
    expect(header.startsWith("vapid t=")).toBe(true);

    const [, token] = header.match(/t=([^,]+)/)!;
    const [encodedHeader, encodedPayload, signature] = token.split(".");

    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
    // The audience is the push service's origin — a token minted for Google's
    // endpoint must be rejected by Mozilla's, which is the whole point.
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:hello@example.com");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // ES256 wants the raw 64-byte r||s pair. A DER signature here is the
    // classic silent failure: every push returns 401 and nothing says why.
    const raw = Buffer.from(signature, "base64url");
    expect(raw.length).toBe(64);

    const verifier = createVerify("SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    const spki = Buffer.concat([Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"), keys.getPublicKey()]);
    const verified = verifier.verify({ key: createPublicKey({ key: spki, format: "der", type: "spki" }), dsaEncoding: "ieee-p1363" }, raw);
    expect(verified).toBe(true);
  });

  it("produces an aes128gcm body with the header a browser can read", () => {
    const subscription = fakeSubscription();
    const { body, headers } = encrypt(JSON.stringify({ title: "A payment came in" }), subscription);

    expect(headers["Content-Encoding"]).toBe("aes128gcm");

    // 16-byte salt, 4-byte record size, 1-byte key length, then the server's
    // own 65-byte public point. A browser that cannot find its salt here
    // silently drops the notification.
    expect(body.subarray(16, 20).readUInt32BE(0)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body.length).toBeGreaterThan(86);

    // Different every time: the salt and the server key are fresh per message.
    const again = encrypt(JSON.stringify({ title: "A payment came in" }), subscription);
    expect(again.body.equals(body)).toBe(false);
  });

  it("remembers each device separately, because one person has several", async () => {
    const phone = fakeSubscription();
    const laptop = { ...fakeSubscription(), endpoint: "https://updates.push.services.mozilla.com/wpush/v2/xyz" };

    await subscribe({ tenantId, membershipId, subscription: phone });
    await subscribe({ tenantId, membershipId, subscription: laptop });

    const status = await pushStatus(tenantId);
    expect(status.devices).toBe(2);
    expect(status.privacy).toMatch(/never an amount/i);

    // Subscribing the same endpoint again replaces rather than duplicates.
    await subscribe({ tenantId, membershipId, subscription: phone });
    expect((await pushStatus(tenantId)).devices).toBe(2);

    await unsubscribe(phone.endpoint);
    expect((await pushStatus(tenantId)).devices).toBe(1);
  });

  it("says plainly when the deployment has no keys rather than failing quietly", async () => {
    // No VAPID keys are set in a test run, which is the same state a fresh
    // deployment is in.
    expect(pushConfigured()).toBe(false);
    const status = await pushStatus(tenantId);
    expect(status.configured).toBe(false);
    expect(status.note).toMatch(/dashboard bell still works/i);
  });
});

describe("the screen somebody uses standing up", () => {
  // A job card hangs off the invoice it was raised from, so one has to exist
  // before there is anything for a technician to be sent to.
  async function job(overrides: Record<string, unknown> = {}) {
    const invoice = await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 150_000 },
    });
    return prisma.jobCard.create({
      data: {
        tenantId,
        partyId,
        transactionId: invoice.id,
        title: "Replace gutter",
        status: "SCHEDULED",
        assignedToId: membershipId,
        scheduledAt: new Date(),
        siteAddress: "9 Oak Avenue, Benoni",
        ...overrides,
      },
    });
  }

  it("shows today's work, and keeps yesterday's unfinished job rather than dropping it", async () => {
    await job();
    await job({ title: "Yesterday's leak", scheduledAt: new Date(Date.now() - DAY), status: "IN_PROGRESS" });

    const day = await todayInTheField({ tenantId, membershipId });
    expect(day.jobs).toHaveLength(2);
    // The thing a technician most often needs is the job they did not finish.
    expect(day.jobs.some((row) => row.title === "Yesterday's leak")).toBe(true);
    expect(day.greeting).toMatch(/2 jobs/);
  });

  it("offers two or three actions, never a menu", async () => {
    await job();
    const day = await todayInTheField({ tenantId, membershipId });
    const [first] = day.jobs;
    expect(first.actions.length).toBeLessThanOrEqual(4);
    expect(first.actions[0].key).toBe("start");
    // A customer with a number always gets a call button; that is the action
    // most used on site and it must never be buried.
    expect(first.actions.some((action) => action.key === "call")).toBe(true);
  });

  it("knows when somebody is clocked on to one of them", async () => {
    const card = await job();
    await prisma.timeEntry.create({ data: { tenantId, membershipId, jobCardId: card.id, clockInAt: new Date() } });

    const day = await todayInTheField({ tenantId, membershipId });
    const [row] = day.jobs;
    expect(row.onIt).toBe(true);
    expect(row.actions.map((action) => action.key)).toContain("stop");
    expect(row.actions.map((action) => action.key)).not.toContain("start");
    expect(day.greeting).toMatch(/clocked on/i);
  });

  it("queues everything rather than writing it, so it survives a tunnel", async () => {
    const card = await job();
    await recordInTheField({
      tenantId,
      membershipId,
      jobCardId: card.id,
      action: "start",
      at: new Date(Date.now() - 3600_000),
      clientRef: "device-1",
    });

    const queued = await prisma.offlineChange.findMany({ where: { tenantId } });
    expect(queued).toHaveLength(1);
    expect(queued[0].kind).toBe("time.clockOn");
    // The moment it happened, not the moment it synced — an hour ago.
    expect(Date.now() - queued[0].happenedAt.getTime()).toBeGreaterThan(3000_000);
  });

  it("does not record the same tap twice when a phone retries", async () => {
    const card = await job();
    for (let i = 0; i < 3; i++) {
      await recordInTheField({ tenantId, membershipId, jobCardId: card.id, action: "done", at: new Date(), clientRef: "same-tap" });
    }
    expect(await prisma.offlineChange.count({ where: { tenantId } })).toBe(1);
  });

  it("gives directions from coordinates when it has them, and the address otherwise", () => {
    expect(directionsTo({ lat: -26.19, lng: 28.32, where: "anything" })).toContain("-26.19,28.32");
    expect(directionsTo({ lat: null, lng: null, where: "9 Oak Avenue, Benoni" })).toContain("9%20Oak%20Avenue");
    expect(directionsTo({ lat: null, lng: null, where: null })).toBeNull();
  });

  it("says nothing is on rather than showing an empty list", async () => {
    const day = await todayInTheField({ tenantId, membershipId });
    expect(day.jobs).toEqual([]);
    expect(day.greeting).toMatch(/nothing on/i);
  });
});
