// What a key can do, in the words of the API rather than the codebase.
//
// /v1/me returns this so an integrator can see up front why a later call will
// 403, instead of discovering their key's limits one failed request at a time.

import { ALL_CAPABILITIES, can, type Role } from "@/lib/core/access";

/** Capability -> the API operations it unlocks. */
const OPERATIONS: Record<string, string[]> = {
  "quote:create": ["quotes.create"],
  "quote:send": ["quotes.send"],
  "invoice:create": ["invoices.create"],
  "payment:record": ["payments.record"],
  "product:manage": ["products.create", "products.update"],
  "task:manage": ["customers.create", "tasks.create", "tasks.update"],
  "delivery:log": ["deliveries.log"],
  "connection:invite": ["connections.invite"],
  "connection:accept": ["connections.accept"],
  "staff:manage": ["staff.manage"],
};

export function CAPABILITIES_FOR(role: Role, readOnly: boolean) {
  const read = ["customers.read", "products.read", "quotes.read", "invoices.read", "tasks.read"];
  if (readOnly) return { read, write: [] as string[] };

  const write = ALL_CAPABILITIES.filter((c) => can(role, c)).flatMap((c) => OPERATIONS[c] ?? []);
  return { read, write: [...new Set(write)].sort() };
}
