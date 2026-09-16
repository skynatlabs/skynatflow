// Telling somebody something when they are not looking at the screen.
//
// This is the part of "there is an app" that people actually mean. Nobody
// wants a business system on their phone; they want to be told the moment a
// quote is accepted or a payment lands, and to tap it and be in the right
// place. That is push, and it does not need an app store: the Web Push
// standard works on Android and desktop today, and on iPhone since 16.4 for
// anything added to the home screen.
//
// Written without a library on purpose. Web Push is three things — a VAPID
// JWT to prove who is sending, an ECDH key agreement with the browser's
// public key, and AES-128-GCM over the payload — and every one of them is in
// Node's own crypto. A dependency here would be a third party in the path of
// every notification this business ever sends.
//
// What it will never do: a notification is a nudge, never the content. "A
// payment came in" and a link, not the amount and the customer — a phone on a
// table shows its lock screen to whoever walks past.

import { createECDH, createHmac, createSign, createPrivateKey, randomBytes, createCipheriv } from "crypto";
import { prisma } from "@/lib/db";

/** Nothing can be sent until a deployment has its own keys. */
export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function publicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export interface Subscription {
  endpoint: string;
  /** The browser's public key, base64url. */
  p256dh: string;
  /** The browser's auth secret, base64url. */
  auth: string;
}

/**
 * Remember where to reach this person.
 *
 * Keyed on the endpoint, because one person legitimately has several — a
 * phone, a laptop, the tablet in the workshop — and each is a separate
 * subscription that expires on its own.
 */
export async function subscribe(params: { tenantId: string; membershipId: string; subscription: Subscription; userAgent?: string }) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: params.subscription.endpoint },
    create: {
      tenantId: params.tenantId,
      membershipId: params.membershipId,
      endpoint: params.subscription.endpoint,
      p256dh: params.subscription.p256dh,
      auth: params.subscription.auth,
      userAgent: params.userAgent ?? null,
    },
    update: { tenantId: params.tenantId, membershipId: params.membershipId, p256dh: params.subscription.p256dh, auth: params.subscription.auth, failures: 0 },
  });
}

export async function unsubscribe(endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

// ---------------------------------------------------------------- the crypto

function b64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

/**
 * The VAPID header: a signed claim that this server is who it says it is.
 *
 * The audience is the push service's own origin — a token minted for Google's
 * endpoint is rejected by Mozilla's, which is the whole point.
 */
export function vapidHeader(endpoint: string, subject: string, publicKeyB64: string, privateKeyB64: string, now = Date.now()): string {
  const audience = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        // Twelve hours. The spec allows twenty-four; half of that leaves room
        // for a clock that is wrong without being rejected.
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );

  const unsigned = `${header}.${payload}`;
  const key = createPrivateKey({
    key: pkcs8From(fromB64url(privateKeyB64), fromB64url(publicKeyB64)),
    format: "der",
    type: "pkcs8",
  });

  const signer = createSign("SHA256");
  signer.update(unsigned);
  // ES256 wants the raw 64-byte r||s pair, not the DER structure Node
  // produces by default. Getting this wrong is the classic silent failure:
  // every push returns 401 and nothing says why.
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });

  return `vapid t=${unsigned}.${b64url(signature)}, k=${publicKeyB64}`;
}

/** Wrap a raw P-256 private scalar and its public point as a PKCS#8 key. */
function pkcs8From(privateScalar: Buffer, publicPoint: Buffer): Buffer {
  const prefix = Buffer.from("308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420", "hex");
  const publicPrefix = Buffer.from("a144034200", "hex");
  return Buffer.concat([prefix, privateScalar, publicPrefix, publicPoint]);
}

export interface EncryptedBody {
  body: Buffer;
  headers: Record<string, string>;
}

/**
 * aes128gcm, the only content encoding browsers still accept.
 *
 * The salt and the server's key both go in the header the browser reads, so
 * it can derive the same secret; the record padding delimiter is a single
 * 0x02 byte, which is the "last record" marker.
 */
export function encrypt(payload: string, subscription: Subscription): EncryptedBody {
  const salt = randomBytes(16);
  const server = createECDH("prime256v1");
  server.generateKeys();

  const clientPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  const shared = server.computeSecret(clientPublic);

  const info = Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, server.getPublicKey()]);
  const ikm = hkdf(authSecret, shared, info, 32);

  const contentKey = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const plaintext = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])]);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const serverPublic = server.getPublicKey();
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);

  const header = Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic]);

  return {
    body: Buffer.concat([header, ciphertext]),
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" },
  };
}

export interface PushMessage {
  title: string;
  /** A nudge, never the content. A phone on a table shows this to the room. */
  body: string;
  /** Where tapping it lands. */
  url?: string;
  tag?: string;
}

export type SendResult = { ok: true } | { ok: false; gone: boolean; status: number; reason: string };

/** One notification to one device. */
export async function sendTo(subscription: Subscription, message: PushMessage): Promise<SendResult> {
  if (!pushConfigured()) return { ok: false, gone: false, status: 0, reason: "No push keys configured on this deployment." };

  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@skynatflow.com";
  const { body, headers } = encrypt(JSON.stringify(message), subscription);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: vapidHeader(subscription.endpoint, subject, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!),
      TTL: "86400",
      Urgency: "normal",
    },
    body: new Uint8Array(body),
  });

  if (response.ok) return { ok: true };

  // 404 and 410 mean the browser threw the subscription away — the person
  // cleared their site data, or uninstalled. That is not an error to retry,
  // it is a row to delete.
  const gone = response.status === 404 || response.status === 410;
  return { ok: false, gone, status: response.status, reason: gone ? "That device is no longer subscribed." : `The push service answered ${response.status}.` };
}

/**
 * Everybody who should hear about this.
 *
 * A dead subscription is removed rather than retried, and a device that keeps
 * failing for another reason is counted — five strikes and it stops being
 * tried, because a push service that keeps answering 500 will otherwise be
 * hammered on every notification for ever.
 */
export async function push(params: { tenantId: string; membershipId?: string | null; message: PushMessage }) {
  if (!pushConfigured()) {
    return { sent: 0, removed: 0, skipped: 0, note: "Push is not configured on this deployment, so the bell in the dashboard is the only channel." };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.membershipId ? { membershipId: params.membershipId } : {}),
      failures: { lt: 5 },
    },
    take: 100,
  });

  let sent = 0;
  let removed = 0;

  for (const row of subscriptions) {
    const result = await sendTo({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }, params.message);
    if (result.ok) {
      sent += 1;
      if (row.failures > 0) await prisma.pushSubscription.update({ where: { id: row.id }, data: { failures: 0, lastSentAt: new Date() } });
      else await prisma.pushSubscription.update({ where: { id: row.id }, data: { lastSentAt: new Date() } });
      continue;
    }
    if (result.gone) {
      await prisma.pushSubscription.delete({ where: { id: row.id } });
      removed += 1;
      continue;
    }
    await prisma.pushSubscription.update({ where: { id: row.id }, data: { failures: { increment: 1 } } });
  }

  return {
    sent,
    removed,
    skipped: subscriptions.length - sent - removed,
    note: sent === 0 && subscriptions.length === 0 ? "Nobody has turned push on for this workspace yet." : null,
  };
}

/** What a workspace can be told about push, in one call for a settings screen. */
export async function pushStatus(tenantId: string) {
  const [devices, stale] = await Promise.all([
    prisma.pushSubscription.count({ where: { tenantId } }),
    prisma.pushSubscription.count({ where: { tenantId, failures: { gte: 5 } } }),
  ]);

  return {
    configured: pushConfigured(),
    publicKey: publicKey(),
    devices,
    stale,
    note: !pushConfigured()
      ? "No push keys on this deployment. The dashboard bell still works; nothing reaches a phone that is not open."
      : devices === 0
        ? "No devices yet. Turning it on takes one tap, on each phone or computer that should be told."
        : `${devices} ${devices === 1 ? "device" : "devices"} will be told.${stale > 0 ? ` ${stale} stopped answering and are no longer tried.` : ""}`,
    privacy: "A notification carries a nudge and a link, never an amount or a customer's name — a phone on a table shows its lock screen to whoever walks past.",
  };
}
