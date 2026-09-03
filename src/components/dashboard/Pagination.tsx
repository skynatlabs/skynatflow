import Link from "next/link";

export function Pagination({
  page,
  pageCount,
  paramName = "page",
  extraParams,
}: {
  page: number;
  pageCount: number;
  /** Query param to write the page number into — defaults to "page". Use a
   * distinct name per section when a page has more than one independent
   * paginated list, so paging one doesn't reset the other. */
  paramName?: string;
  /** Other query params to preserve on the link (e.g. another section's
   * current page) — merged in alongside paramName. */
  extraParams?: Record<string, string | number | undefined>;
}) {
  if (pageCount <= 1) return null;

  function href(targetPage: number) {
    const params = new URLSearchParams();
    if (extraParams) {
      for (const [key, value] of Object.entries(extraParams)) {
        if (value !== undefined) params.set(key, String(value));
      }
    }
    params.set(paramName, String(targetPage));
    return `?${params.toString()}`;
  }

  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <Link
        href={href(page - 1)}
        aria-disabled={page <= 1}
        className={`kb-pill kb-pill-ghost text-xs ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
      >
        &larr; Prev
      </Link>
      <span className="text-[var(--kb-text-dim)]">
        Page {page} of {pageCount}
      </span>
      <Link
        href={href(page + 1)}
        aria-disabled={page >= pageCount}
        className={`kb-pill kb-pill-ghost text-xs ${page >= pageCount ? "pointer-events-none opacity-40" : ""}`}
      >
        Next &rarr;
      </Link>
    </div>
  );
}
