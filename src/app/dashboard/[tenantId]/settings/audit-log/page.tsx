import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ q?: string; capability?: string }>;
}) {
  const { tenantId } = await params;
  const { q, capability } = await searchParams;

  const entries = await prisma.auditLog.findMany({
    where: {
      tenantId,
      ...(capability ? { capability } : {}),
      ...(q
        ? {
            OR: [
              { targetType: { contains: q, mode: "insensitive" } },
              { targetId: { contains: q, mode: "insensitive" } },
              { actorId: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const users = await prisma.user.findMany({
    where: { id: { in: entries.map((e) => e.actorId).filter((id): id is string => !!id) } },
  });
  const userById = new Map(users.map((u) => [u.id, u.name ?? u.email]));

  const capabilities = Array.from(new Set(entries.map((e) => e.capability))).sort();

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Audit log</h1>
        <a
          href={`/dashboard/${tenantId}/settings/audit-log/export${capability ? `?capability=${capability}` : ""}`}
          className="kb-pill text-xs"
        >
          Export CSV
        </a>
      </div>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every mutating action, human or AI — who, what, and when. Last 200 entries.
      </p>

      <form method="get" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by target or actor..."
          className="flex-1 rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2 text-sm text-[var(--kb-text)]"
        />
        <select
          name="capability"
          defaultValue={capability ?? ""}
          className="rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2 text-sm text-[var(--kb-text)]"
        >
          <option value="">All actions</option>
          {capabilities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit" className="kb-pill kb-pill-primary text-xs">
          Filter
        </button>
      </form>

      <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-4 p-4 text-sm">
            <div className="min-w-0">
              <p className="text-[var(--kb-text)]">
                <span className="font-medium">
                  {e.actorType === "user"
                    ? (e.actorId && userById.get(e.actorId)) || "Unknown user"
                    : e.actorType === "ai"
                      ? "AI"
                      : "System"}
                </span>{" "}
                <span className="text-[var(--kb-text-dim)]">{e.capability}</span>{" "}
                <span className="text-[var(--kb-text-dim)]">
                  on {e.targetType} {e.targetId.slice(0, 12)}
                </span>
              </p>
            </div>
            <span className="shrink-0 text-xs text-[var(--kb-text-dim)]">
              {e.createdAt.toLocaleString()}
            </span>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="p-4 text-sm text-[var(--kb-text-dim)]">No matching entries.</li>
        )}
      </ul>

      <Link
        href={`/dashboard/${tenantId}/staff`}
        className="mt-6 inline-block text-xs text-[var(--kb-text-dim)] hover:underline"
      >
        &larr; Back to Staff &amp; roles
      </Link>
    </main>
  );
}
