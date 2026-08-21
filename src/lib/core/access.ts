// Phase 8 hardening — a real per-role permission check, wired into every
// mutating server action via requireTenantAccess() + assertCan() (see
// src/lib/auth/tenant-access.ts, which resolves the session to a real
// Membership role before any of these are checked).

export type Role = "OWNER" | "STAFF" | "DRIVER" | "REP" | "TECHNICIAN";

export type Capability =
  | "quote:create"
  | "quote:send"
  | "invoice:create"
  | "payment:record"
  | "delivery:log"
  | "connection:invite"
  | "connection:accept"
  | "task:manage"
  | "staff:manage"
  | "product:manage";

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  OWNER: [
    "quote:create",
    "quote:send",
    "invoice:create",
    "payment:record",
    "delivery:log",
    "connection:invite",
    "connection:accept",
    "task:manage",
    "staff:manage",
    "product:manage",
  ],
  STAFF: [
    "quote:create",
    "quote:send",
    "invoice:create",
    "payment:record",
    "task:manage",
    "product:manage",
  ],
  REP: ["quote:create", "quote:send", "task:manage"],
  DRIVER: ["delivery:log", "task:manage"],
  TECHNICIAN: ["delivery:log", "quote:create", "task:manage"],
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

export const ALL_ROLES: Role[] = ["OWNER", "STAFF", "REP", "TECHNICIAN", "DRIVER"];
export const ALL_CAPABILITIES: Capability[] = [
  "quote:create",
  "quote:send",
  "invoice:create",
  "payment:record",
  "delivery:log",
  "connection:invite",
  "connection:accept",
  "task:manage",
  "staff:manage",
  "product:manage",
];

// Read-only view of the capability matrix — for the permissions settings
// screen. The map itself stays a fixed table, not a per-tenant DB setting
// (see the settings page's own note on why editable roles aren't built yet).
export function capabilityMatrix(): Record<Role, Capability[]> {
  return ROLE_CAPABILITIES;
}
