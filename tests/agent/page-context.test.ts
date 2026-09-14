// The context the agent gets from the page you're standing on.
//
// The security property matters as much as the convenience one: the entity
// hint is derived from the path server-side and scoped to the caller's own
// tenant prefix, so a pathname naming another workspace resolves to nothing.

import { describe, it, expect } from "vitest";
import { describePage, pageContextPrompt } from "../../src/lib/agent/pageContext";

const T = "tenant_abc";
const read = (path: string, customerLabel = "Customer") =>
  describePage({ path, tenantId: T, customerLabel });

describe("describePage", () => {
  it("identifies the record a detail page is about", () => {
    const ctx = read(`/dashboard/${T}/invoices/inv_123`);
    expect(ctx?.entity).toEqual({ type: "Transaction", id: "inv_123" });
    expect(ctx?.description).toBe("one invoice");
  });

  it("keeps the record when the user is on a sub-page of it", () => {
    // "/invoices/inv_1/pay" is still about inv_1 — "mark this paid" there
    // must not lose which invoice it meant.
    const ctx = read(`/dashboard/${T}/invoices/inv_1/pay`);
    expect(ctx?.entity).toEqual({ type: "Transaction", id: "inv_1" });
  });

  it("uses the workspace's own word for a customer", () => {
    expect(read(`/dashboard/${T}/customers/p_1`, "Patient")?.description).toBe(
      "one patient's record"
    );
    expect(read(`/dashboard/${T}/customers/p_1`, "Client")?.description).toBe(
      "one client's record"
    );
  });

  it("describes list pages without inventing an entity", () => {
    const ctx = read(`/dashboard/${T}/overdue`);
    expect(ctx?.description).toBe("overdue invoices");
    expect(ctx?.entity).toBeUndefined();
  });

  it("handles the home page, trailing slashes and query strings", () => {
    expect(read(`/dashboard/${T}`)?.description).toBe("the home dashboard");
    expect(read(`/dashboard/${T}/`)?.description).toBe("the home dashboard");
    expect(read(`/dashboard/${T}/customers?q=acme`)?.description).toBe("the customer list");
  });

  it("refuses a path belonging to another workspace", () => {
    // The whole point: a client that posts someone else's URL gets no
    // context at all, rather than an id the agent would then try to use.
    expect(read("/dashboard/tenant_other/invoices/inv_9")).toBeNull();
    expect(read("/admin/tenants")).toBeNull();
    expect(read("")).toBeNull();
  });

  it("returns nothing for routes it doesn't recognise, rather than guessing", () => {
    expect(read(`/dashboard/${T}/some-future-feature`)).toBeNull();
  });

  it("does not mistake an action segment for a record id", () => {
    // "/quotes/new" is the new-quote form, not the quote called "new".
    const ctx = read(`/dashboard/${T}/quotes/new`);
    expect(ctx?.entity).toBeUndefined();
    expect(ctx?.description).toBe("the list of quotes");
    expect(read(`/dashboard/${T}/products/new`)?.entity).toBeUndefined();
  });
});

describe("pageContextPrompt", () => {
  it("tells the model what 'this' refers to, and to verify it", () => {
    const lines = pageContextPrompt(read(`/dashboard/${T}/invoices/inv_123`)).join("\n");
    expect(lines).toContain("inv_123");
    expect(lines).toContain("Transaction");
    // It must not be trusted blindly — the tools are tenant-scoped and the
    // lookup is what enforces that.
    expect(lines).toMatch(/look\s+it up with your tools/);
  });

  it("says nothing at all when there is no context", () => {
    expect(pageContextPrompt(null)).toEqual([]);
  });

  it("points at the listing when the page isn't one record", () => {
    const lines = pageContextPrompt(read(`/dashboard/${T}/overdue`)).join("\n");
    expect(lines).toContain("overdue invoices");
    expect(lines).not.toContain("id ");
  });
});
