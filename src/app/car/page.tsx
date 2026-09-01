import Link from "next/link";
import { listPagesForAdmin } from "@/lib/core/cms";

export default async function AdminPagesIndex() {
  const pages = await listPagesForAdmin();
  const core = pages.filter((p) => p.group === "core");
  const industries = pages.filter((p) => p.group === "industry");

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Marketing pages</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Edit the flow/Skynat marketing site — text and images per section, no code required.
      </p>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
        Core pages
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {core.map((p) => (
          <PageRow key={p.slug} {...p} />
        ))}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
        Industry pages
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {industries.map((p) => (
          <PageRow key={p.slug} {...p} />
        ))}
      </div>
    </div>
  );
}

function PageRow({
  slug,
  title,
  path,
  updatedAt,
}: {
  slug: string;
  title: string;
  path: string;
  updatedAt: Date | null;
}) {
  return (
    <Link href={`/car/pages/${slug}`} className="kb-card flex items-center justify-between p-4">
      <div>
        <p className="font-semibold text-[var(--kb-text)]">{title}</p>
        <p className="text-xs text-[var(--kb-text-dim)]">{path}</p>
      </div>
      <p className="text-xs text-[var(--kb-text-dim)]">
        {updatedAt ? `Edited ${updatedAt.toLocaleDateString()}` : "Not yet edited"}
      </p>
    </Link>
  );
}
