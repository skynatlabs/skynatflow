// API keys are the front door to every workspace's money. The properties that
// matter are all refusals: a wrong key, a revoked key, an expired key, a
// read-only key writing, and a key from one workspace reaching another's data.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import { mintApiKey, verifyApiKey, listApiKeys, revokeApiKey, hashKey } from "../../src/lib/api/keys";

let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  const a = await prisma.tenant.create({ data: { name: "Key Co A", niche: "RETAIL" } });
  const b = await prisma.tenant.create({ data: { name: "Key Co B", niche: "RETAIL" } });
  tenantA = a.id;
  tenantB = b.id;
});

afterAll(async () => {
  for (const t of [tenantA, tenantB]) {
    await prisma.apiKey.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.delete({ where: { id: t } });
  }
});

describe("minting", () => {
  it("returns the secret once and never stores it", async () => {
    const minted = await mintApiKey({ tenantId: tenantA, name: "CI", role: "OWNER" });

    expect(minted.secret).toMatch(/^flow_sk_[0-9a-f]{12}_[0-9a-f]{48}$/);

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: minted.id } });
    // The database holds a hash and a prefix. Nothing in it reconstructs the key.
    expect(row.keyHash).toBe(hashKey(minted.secret));
    expect(row.keyHash).not.toContain(minted.secret);
    expect(minted.secret).toContain(row.keyPrefix);
  });

  it("lists keys without ever re-revealing them", async () => {
    const keys = await listApiKeys(tenantA);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(Object.keys(k)).not.toContain("keyHash");
    }
  });
});

describe("verifying", () => {
  it("accepts a good key and reports who it is", async () => {
    const minted = await mintApiKey({ tenantId: tenantA, name: "Good", role: "STAFF" });
    const verdict = await verifyApiKey(`Bearer ${minted.secret}`);

    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.caller.tenantId).toBe(tenantA);
      expect(verdict.caller.role).toBe("STAFF");
      expect(verdict.caller.readOnly).toBe(false);
    }
  });

  it("accepts the key with or without the Bearer prefix", async () => {
    const minted = await mintApiKey({ tenantId: tenantA, name: "Bare", role: "STAFF" });
    expect((await verifyApiKey(minted.secret)).ok).toBe(true);
  });

  it("refuses a missing, malformed or unknown key", async () => {
    expect(await verifyApiKey(null)).toMatchObject({ ok: false, reason: "missing" });
    expect(await verifyApiKey("Bearer nonsense")).toMatchObject({ ok: false, reason: "malformed" });
    expect(
      await verifyApiKey("Bearer flow_sk_aaaaaaaaaaaa_" + "b".repeat(48))
    ).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("refuses a key whose secret half is wrong even when the prefix is real", async () => {
    // The attack this stops: harvesting a prefix from a log or a UI listing
    // and guessing the rest.
    const minted = await mintApiKey({ tenantId: tenantA, name: "Prefix probe", role: "OWNER" });
    const tampered = `flow_sk_${minted.prefix}_${"0".repeat(48)}`;
    expect(await verifyApiKey(tampered)).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("refuses a revoked key", async () => {
    const minted = await mintApiKey({ tenantId: tenantA, name: "Doomed", role: "OWNER" });
    await revokeApiKey(tenantA, minted.id);
    expect(await verifyApiKey(minted.secret)).toMatchObject({ ok: false, reason: "revoked" });
  });

  it("refuses an expired key", async () => {
    const minted = await mintApiKey({
      tenantId: tenantA,
      name: "Stale",
      role: "OWNER",
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await verifyApiKey(minted.secret)).toMatchObject({ ok: false, reason: "expired" });
  });

  it("will not let one workspace revoke another's key", async () => {
    const minted = await mintApiKey({ tenantId: tenantB, name: "Theirs", role: "OWNER" });
    await expect(revokeApiKey(tenantA, minted.id)).rejects.toThrow(/not found/i);

    // And it still works, because nothing happened to it.
    expect((await verifyApiKey(minted.secret)).ok).toBe(true);
  });

  it("carries read-only through to the caller", async () => {
    const minted = await mintApiKey({
      tenantId: tenantA, name: "Dashboard", role: "OWNER", readOnly: true,
    });
    const verdict = await verifyApiKey(minted.secret);
    expect(verdict.ok && verdict.caller.readOnly).toBe(true);
  });

  it("stamps last used, so a forgotten key is findable", async () => {
    const minted = await mintApiKey({ tenantId: tenantA, name: "Tracked", role: "STAFF" });
    await verifyApiKey(minted.secret);
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: minted.id } });
    expect(row.lastUsedAt).not.toBeNull();
  });
});

describe("rate limiting", () => {
  it("cuts a key off past its window allowance and says when to retry", async () => {
    const minted = await mintApiKey({ tenantId: tenantA, name: "Noisy", role: "STAFF" });

    // Jump the counter to the limit rather than making 240 real calls.
    await prisma.apiKey.update({
      where: { id: minted.id },
      data: { windowStart: new Date(), windowCount: 240 },
    });

    const verdict = await verifyApiKey(minted.secret);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("rate_limited");
      expect(verdict.retryAfter).toBeGreaterThan(0);
    }
  });

  it("lets the key through again once the window rolls over", async () => {
    const minted = await mintApiKey({ tenantId: tenantA, name: "Recovered", role: "STAFF" });
    await prisma.apiKey.update({
      where: { id: minted.id },
      data: { windowStart: new Date(Date.now() - 120_000), windowCount: 9999 },
    });

    const verdict = await verifyApiKey(minted.secret);
    expect(verdict.ok).toBe(true);

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: minted.id } });
    expect(row.windowCount).toBe(1);
  });
});
