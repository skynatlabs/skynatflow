import { prisma } from "@/lib/db";
import { getOrgChart, type OrgNode } from "@/lib/core/org";
import { setManagerAction, setDepartmentAction } from "./actions";

function OrgTree({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  return (
    <div style={{ marginLeft: depth * 24 }} className="mt-2">
      <div className="kb-card flex items-center justify-between px-4 py-2">
        <div>
          <p className="text-sm font-medium text-[var(--kb-text)]">{node.name}</p>
          <p className="text-xs text-[var(--kb-text-dim)]">
            {node.role}
            {node.department ? ` · ${node.department}` : ""}
          </p>
        </div>
      </div>
      {node.reports.map((r) => (
        <OrgTree key={r.membershipId} node={r} depth={depth + 1} />
      ))}
    </div>
  );
}

export default async function OrgPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [tree, memberships] = await Promise.all([
    getOrgChart(tenantId),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Company hierarchy</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Who reports to whom — from owner to every role on the team.
      </p>

      <div className="mt-6">
        {tree.map((node) => (
          <OrgTree key={node.membershipId} node={node} />
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Set reporting line</h2>
      <div className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
        {memberships.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <p className="text-sm font-medium text-[var(--kb-text)]">{m.user.name ?? m.user.email}</p>
            <div className="flex items-center gap-2">
              <form action={setDepartmentAction} className="flex items-center gap-1">
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="membershipId" value={m.id} />
                <input
                  name="department"
                  defaultValue={m.department ?? ""}
                  placeholder="Department"
                  className="w-28 rounded-md border border-[var(--kb-panel-border)] bg-white px-2 py-1 text-xs"
                />
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">Save</button>
              </form>
              <form action={setManagerAction} className="flex items-center gap-1">
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="membershipId" value={m.id} />
                <select name="managerId" defaultValue={m.managerId ?? ""} className="rounded-md border border-[var(--kb-panel-border)] bg-white px-2 py-1 text-xs">
                  <option value="">No manager</option>
                  {memberships.filter((x) => x.id !== m.id).map((x) => (
                    <option key={x.id} value={x.id}>{x.user.name ?? x.user.email}</option>
                  ))}
                </select>
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">Save</button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
