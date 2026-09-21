// The error recorder.
//
// Two properties matter more than the rest: it must never throw (a reporter
// that can fail turns one failure into two, and the second has no reporter),
// and it must never store anything that identifies a person or a business.
// An error message carries whatever was interpolated into it.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import { captureError, fingerprintOf, markErrorHandled, purgeOldErrors, recentErrors, redact } from "../../src/lib/errors";

const ROUTE = "/test/errors";

async function wipe() {
  await prisma.errorEvent.deleteMany({ where: { route: ROUTE } });
}
beforeEach(wipe);
afterAll(wipe);

describe("redaction", () => {
  it("removes anything that identifies somebody", () => {
    expect(redact("Could not email thabo@naledi.co.za about it")).toBe("Could not email [email] about it");
    expect(redact("No answer on +27 82 555 1234")).toContain("[number]");
    expect(redact("Party clx8k2h9a0000abcd1234efgh not found")).toBe("Party [id] not found");
  });

  it("leaves a message that says nothing private alone", () => {
    expect(redact("That entry doesn't balance")).toBe("That entry doesn't balance");
  });

  it("caps the length, so one enormous stack cannot fill the table", () => {
    const long = "at someFunction (/app/src/lib/thing.ts:12:5)\n".repeat(400);
    expect(redact(long, 100)).toHaveLength(100);
  });

  it("does not swallow a whole stack as one id", () => {
    // The id pattern is bounded at the top end. Without that, a long
    // unbroken run of characters reads as a single enormous id and the
    // entire message is replaced by "[id]".
    const blob = "x".repeat(9000);
    expect(redact(blob, 500)).not.toBe("[id]");
  });
});

describe("fingerprinting", () => {
  it("treats the same fault on the same route as one thing", () => {
    const a = fingerprintOf({ message: "Boom", route: "/a" });
    const b = fingerprintOf({ message: "Boom", route: "/a" });
    expect(a).toBe(b);
  });

  it("keeps the same message on different routes apart", () => {
    expect(fingerprintOf({ message: "Boom", route: "/a" })).not.toBe(fingerprintOf({ message: "Boom", route: "/b" }));
  });
});

describe("recording", () => {
  it("groups repeats instead of appending", async () => {
    // One bad deploy throwing on every request should be one row.
    for (let i = 0; i < 5; i++) {
      await captureError({ message: "Something broke", route: ROUTE, method: "GET" });
    }
    const rows = (await recentErrors()).filter((r) => r.route === ROUTE);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
  });

  it("strips identifying detail before it is stored", async () => {
    await captureError({ message: "Could not reach lerato@example.com", route: ROUTE });
    const rows = (await recentErrors()).filter((r) => r.route === ROUTE);
    expect(rows[0].message).toBe("Could not reach [email]");
  });

  it("reopens a fault that comes back after being marked handled", async () => {
    await captureError({ message: "Recurring", route: ROUTE });
    const [row] = (await recentErrors()).filter((r) => r.route === ROUTE);
    await markErrorHandled(row.id);
    expect((await recentErrors()).find((r) => r.id === row.id)?.resolvedAt).not.toBeNull();

    await captureError({ message: "Recurring", route: ROUTE });
    expect((await recentErrors()).find((r) => r.id === row.id)?.resolvedAt).toBeNull();
  });

  it("never throws, whatever it is handed", async () => {
    await expect(captureError({ message: "" })).resolves.toBeUndefined();
    await expect(captureError({ message: "x".repeat(50_000), route: ROUTE })).resolves.toBeUndefined();
  });

  it("sweeps only what was handled and has gone quiet", async () => {
    await captureError({ message: "Old and handled", route: ROUTE });
    const [row] = (await recentErrors()).filter((r) => r.route === ROUTE);
    await markErrorHandled(row.id);
    await prisma.errorEvent.update({
      where: { id: row.id },
      data: { lastSeen: new Date(Date.now() - 90 * 86_400_000) },
    });

    await captureError({ message: "Still open", route: ROUTE });
    await purgeOldErrors(60);

    const left = (await recentErrors()).filter((r) => r.route === ROUTE);
    expect(left.map((r) => r.message)).toEqual(["Still open"]);
  });
});
