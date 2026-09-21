// Roles this workspace defined for itself.
//
// The built-in five are shown alongside, read-only, so somebody can see what
// they are starting from rather than guessing. A capability this person does
// not hold themselves is shown but cannot be ticked — the core layer refuses
// it either way, and a disabled box explains why better than an error does.

import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { ALL_CAPABILITIES, can, capabilityMatrix, ALL_ROLES } from "@/lib/core/access";
import { listWorkspaceRoles } from "@/lib/core/roles";
import { deleteRoleAction, saveRoleAction } from "./actions";

export const dynamic = "force-dynamic";

const CAPABILITY_WORDS: Record<string, string> = {
  "quote:create": "Write quotes",
  "quote:send": "Send quotes to customers",
  "invoice:create": "Raise invoices",
  "payment:record": "Record money received",
  "delivery:log": "Log deliveries and field work",
  "connection:invite": "Invite trading partners",
  "connection:accept": "Accept trading invitations",
  "task:manage": "Manage tasks",
  "staff:manage": "Manage people, roles and settings",
  "product:manage": "Manage products and prices",
};

export default async function RolesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  if (!can(access, "staff:manage")) notFound();

  const [custom, builtIn] = await Promise.all([
    listWorkspaceRoles(tenantId),
    Promise.resolve(capabilityMatrix()),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">Roles</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        The five built-in roles fit most businesses. Define your own when they don&apos;t — a
        compliance officer who sees everything and changes nothing, a bookkeeper who touches money
        but not customers. You can only give a role something you can do yourself.
      </p>

      {custom.length > 0 && (
        <section className="mt-6 grid gap-3">
          {custom.map((role) => (
            <div key={role.id} className="kb-card p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--kb-text)]">{role.name}</h2>
                <span className="text-xs text-[var(--kb-text-dim)]">
                  {role.members === 0
                    ? "Nobody on it yet"
                    : `${role.members} ${role.members === 1 ? "person" : "people"}`}
                </span>
              </div>

              <form action={saveRoleAction.bind(null, tenantId)} className="mt-3">
                <input type="hidden" name="key" value={role.key} />
                <input type="hidden" name="name" value={role.name} />
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {ALL_CAPABILITIES.map((capability) => {
                    const held = can(access, capability);
                    return (
                      <label
                        key={capability}
                        className="flex items-start gap-2 text-xs"
                        style={{ opacity: held ? 1 : 0.45 }}
                      >
                        <input
                          type="checkbox"
                          name="capabilities"
                          value={capability}
                          defaultChecked={role.capabilities.includes(capability)}
                          disabled={!held}
                          className="mt-0.5"
                        />
                        <span className="text-[var(--kb-text)]">
                          {CAPABILITY_WORDS[capability] ?? capability}
                          {!held && (
                            <span className="block text-[10px] text-[var(--kb-text-dim)]">
                              You can&apos;t do this yourself, so you can&apos;t grant it
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <button type="submit" className="kb-pill kb-pill-primary mt-3 text-xs">
                  Save {role.name}
                </button>
              </form>

              {role.members === 0 && (
                <form action={deleteRoleAction.bind(null, tenantId)} className="mt-2">
                  <input type="hidden" name="key" value={role.key} />
                  <button type="submit" className="text-xs text-[var(--kb-text-dim)] underline">
                    Delete this role
                  </button>
                </form>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">Add a role</h2>
        <form action={saveRoleAction.bind(null, tenantId)} className="mt-3">
          <label className="block text-xs text-[var(--kb-text-dim)]">
            What is it called?
            <input
              name="name"
              required
              placeholder="Compliance officer"
              className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2.5 text-sm text-[var(--kb-text)]"
            />
          </label>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {ALL_CAPABILITIES.filter((c) => can(access, c)).map((capability) => (
              <label key={capability} className="flex items-start gap-2 text-xs">
                <input type="checkbox" name="capabilities" value={capability} className="mt-0.5" />
                <span className="text-[var(--kb-text)]">{CAPABILITY_WORDS[capability] ?? capability}</span>
              </label>
            ))}
          </div>
          <button type="submit" className="kb-pill kb-pill-primary mt-3 text-xs">
            Create role
          </button>
        </form>
      </section>

      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          The built-in roles
        </h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          These cannot be changed or renamed, so a workspace can never lock itself out by
          redefining what an owner is.
        </p>
        <ul className="mt-3 grid gap-2">
          {ALL_ROLES.map((role) => (
            <li key={role} className="text-xs">
              <span className="font-medium text-[var(--kb-text)]">{role}</span>
              <span className="text-[var(--kb-text-dim)]">
                {" — "}
                {builtIn[role].length === ALL_CAPABILITIES.length
                  ? "everything"
                  : builtIn[role].map((c) => CAPABILITY_WORDS[c] ?? c).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
