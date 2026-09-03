import Link from "next/link";

export function Pagination({ page, pageCount }: { page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <Link
        href={`?page=${page - 1}`}
        aria-disabled={page <= 1}
        className={`kb-pill kb-pill-ghost text-xs ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
      >
        &larr; Prev
      </Link>
      <span className="text-[var(--kb-text-dim)]">
        Page {page} of {pageCount}
      </span>
      <Link
        href={`?page=${page + 1}`}
        aria-disabled={page >= pageCount}
        className={`kb-pill kb-pill-ghost text-xs ${page >= pageCount ? "pointer-events-none opacity-40" : ""}`}
      >
        Next &rarr;
      </Link>
    </div>
  );
}
