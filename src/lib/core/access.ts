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
  constructor(role: string, capability: Capability) {
    super(`Role ${role} is not permitted to perform ${capability}`);
    this.name = "AccessDeniedError";
  }
}

/**
 * Anything that already knows what it may do.
 *
 * A workspace can define its own roles, so a role NAME is no longer enough to
 * decide a question — the same name means different things in two
 * workspaces. Resolution happens once, at the access checkpoint, and what
 * travels from there is the resolved list rather than the label.
 */
export interface CapabilityHolder {
  /** The role's name or key, for the error message and for display. */
  role: string;
  /** Already resolved: built-in table, or the workspace's own definition. */
  capabilities: Capability[];
}

function isHolder(subject: Role | CapabilityHolder): subject is CapabilityHolder {
  return typeof subject === "object" && subject !== null && "capabilities" in subject;
}

/** What a built-in role may do. Unknown names get nothing, never everything. */
export function capabilitiesOfBuiltIn(role: string): Capability[] {
  return ROLE_CAPABILITIES[role as Role] ?? [];
}

export function isBuiltInRole(role: string): role is Role {
  return role in ROLE_CAPABILITIES;
}

/**
 * Resolve a stored role to what it may actually do.
 *
 * `custom` is the workspace's own role definitions, when the stored value is
 * not a built-in name. An unknown capability string in a custom role is
 * dropped rather than rejected — removing a capability from the product
 * should not break every workspace that had granted it.
 */
export function resolveCapabilities(
  role: string,
  custom?: { key: string; capabilities: string[] } | null
): Capability[] {
  if (isBuiltInRole(role)) return capabilitiesOfBuiltIn(role);
  if (!custom || custom.key !== role) return [];
  return custom.capabilities.filter((c): c is Capability => ALL_CAPABILITIES.includes(c as Capability));
}

/**
 * Refuse unless this caller holds the capability.
 *
 * Takes either a resolved holder (what requireTenantAccess returns, and the
 * form every call site should use) or a bare built-in role name, which is
 * still correct for the places that genuinely only have one — an API key's
 * role, a test, a default.
 */
export function assertCan(subject: Role | CapabilityHolder, capability: Capability): void {
  if (!can(subject, capability)) {
    throw new AccessDeniedError(isHolder(subject) ? subject.role : subject, capability);
  }
}

export function can(subject: Role | CapabilityHolder, capability: Capability): boolean {
  if (isHolder(subject)) return subject.capabilities.includes(capability);
  return ROLE_CAPABILITIES[subject]?.includes(capability) ?? false;
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
