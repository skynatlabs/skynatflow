// Phase 8 hardening — a real per-role permission check, not a comment
// promising one later. Every mutating Business Graph API call should be
// wrapped with this once it's called from a request handler with a known
// actor (owner UI action, mobile app request, or AI tool-call).
//
// This does NOT yet replace the Phase 0 Auth.js checkpoint — there's still
// no session -> user resolution wired in, so nothing calls this for real
// yet. What's here is the enforcement primitive itself, ready to wire in
// the moment sessions exist, rather than leaving that as a TODO comment.

export type Role = "OWNER" | "STAFF" | "DRIVER" | "REP" | "TECHNICIAN";

export type Capability =
  | "quote:create"
  | "quote:send"
  | "invoice:create"
  | "payment:record"
  | "delivery:log"
  | "connection:invite"
  | "connection:accept";

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  OWNER: [
    "quote:create",
    "quote:send",
    "invoice:create",
    "payment:record",
    "delivery:log",
    "connection:invite",
    "connection:accept",
  ],
  STAFF: ["quote:create", "quote:send", "invoice:create", "payment:record"],
  REP: ["quote:create", "quote:send"],
  DRIVER: ["delivery:log"],
  TECHNICIAN: ["delivery:log", "quote:create"],
};

export class AccessDeniedError extends Error {
  constructor(role: Role, capability: Capability) {
    super(`Role ${role} is not permitted to perform ${capability}`);
    this.name = "AccessDeniedError";
  }
}

export function assertCan(role: Role, capability: Capability): void {
  if (!ROLE_CAPABILITIES[role]?.includes(capability)) {
    throw new AccessDeniedError(role, capability);
  }
}

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}
