// API keys: minting, hashing, and turning a header back into a caller.
//
// The secret half of a key is never stored. What goes in the database is a
// SHA-256 of the whole key plus its visible prefix, so a leaked database
// hands nobody a working credential — the same posture the app already takes
// with payment webhook secrets.
//
// A key carries a Role, not its own permission list. The app has exactly one
// permission model (Role -> Capability in lib/core/access.ts) and every core
// function is written against it; a parallel scheme for API callers would be
// two things to keep in step, and the one that drifts is the one nobody
// watches.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/core/audit";
import type { Role } from "@/lib/core/access";

/** Keys look like flow_sk_<prefix>_<secret>. The prefix is safe to display. */
const KEY_PREFIX = "flow_sk";
const PREFIX_BYTES = 6; // 12 hex chars
const SECRET_BYTES = 24; // 48 hex chars

export interface MintedKey {
  id: string;
  /** Shown exactly once. Never recoverable afterwards. */
  secret: string;
  prefix: string;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function mintApiKey(params: {
  tenantId: string;
  name: string;
  role: Role;
  readOnly?: boolean;
  expiresAt?: Date | null;
  createdBy?: string;
}): Promise<MintedKey> {
  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("hex");
  const full = `${KEY_PREFIX}_${prefix}_${secret}`;

  const row = await prisma.apiKey.create({
    data: {
      tenantId: params.tenantId,
      name: params.name.slice(0, 80),
      keyPrefix: prefix,
      keyHash: hashKey(full),
      role: params.role,
      readOnly: params.readOnly ?? false,
      expiresAt: params.expiresAt ?? null,
      createdBy: params.createdBy ?? null,
    },
    select: { id: true },
  });

  return { id: row.id, secret: full, prefix };
}

export interface ApiCaller {
  keyId: string;
  tenantId: string;
  role: Role;
  readOnly: boolean;
  name: string;
}

export type KeyFailure =
  | "missing"
  | "malformed"
  | "unknown"
  | "revoked"
  | "expired"
  | "rate_limited";

export type KeyVerdict =
  | { ok: true; caller: ApiCaller; retryAfter?: never }
  | { ok: false; reason: KeyFailure; retryAfter?: number };

/** Requests per window, per key. Generous enough to be invisible in normal use. */
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 240;

/**
 * Resolves an Authorization header into a caller.
 *
 * The lookup is by prefix and the comparison is constant-time on the hash:
 * looking the row up by the hash itself would work, but comparing in the
 * database leaks timing in a way that is trivial to avoid here.
 */
export async function verifyApiKey(header: string | null): Promise<KeyVerdict> {
  if (!header) return { ok: false, reason: "missing" };

  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  const parts = raw.split("_");
  if (parts.length !== 4 || `${parts[0]}_${parts[1]}` !== KEY_PREFIX) {
    return { ok: false, reason: "malformed" };
  }

  const row = await prisma.apiKey.findUnique({ where: { keyPrefix: parts[2] } });
  if (!row) return { ok: false, reason: "unknown" };

  const expected = Buffer.from(row.keyHash, "hex");
  const actual = Buffer.from(hashKey(raw), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "unknown" };
  }

  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const now = new Date();
  const windowAge = now.getTime() - row.windowStart.getTime();
  const fresh = windowAge >= WINDOW_MS;
  const count = fresh ? 1 : row.windowCount + 1;

  if (!fresh && count > WINDOW_LIMIT) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfter: Math.ceil((WINDOW_MS - windowAge) / 1000),
    };
  }

  await prisma.apiKey.update({
    where: { id: row.id },
    data: {
      lastUsedAt: now,
      windowStart: fresh ? now : row.windowStart,
      windowCount: count,
    },
  });

  return {
    ok: true,
    caller: {
      keyId: row.id,
      tenantId: row.tenantId,
      role: row.role as Role,
      readOnly: row.readOnly,
      name: row.name,
    },
  };
}

export async function listApiKeys(tenantId: string) {
  return prisma.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, keyPrefix: true, role: true, readOnly: true,
      createdAt: true, lastUsedAt: true, revokedAt: true, expiresAt: true,
    },
  });
}

export async function revokeApiKey(tenantId: string, keyId: string, actorId?: string | null) {
  const updated = await prisma.apiKey.updateMany({
    where: { id: keyId, tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count === 0) throw new Error("Key not found, or already revoked.");

  // Credential lifecycle is one of the three things an enterprise security
  // review asks for by name, alongside authentication events and role
  // changes. A key being revoked is also the shape of an incident response,
  // and an incident with no record of when the key was pulled is a much
  // longer conversation.
  await recordAudit({
    tenantId,
    actorType: actorId ? "user" : "system",
    actorId: actorId ?? undefined,
    capability: "staff:manage",
    targetType: "ApiKey",
    targetId: keyId,
    metadata: { revoked: true },
  }).catch((err) => console.error("[api] could not record the key revocation:", err));
}
