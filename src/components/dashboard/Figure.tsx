"use client";

// A number that opens its workings.
//
// Any figure an officer or a report shows is a button: one tap shows the
// lines that add up to it and, where it rests on one, the assumption. It is
// what makes somebody act on a finding instead of doubting it, and it costs
// the screen nothing until it is asked for.

import { useEffect, useId, useRef, useState } from "react";

export interface Working {
  label: string;
  value: string;
}

export function Figure({
  children,
  workings,
  note,
  className = "",
}: {
  children: React.ReactNode;
  workings: Working[];
  note?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (workings.length === 0 && !note) return <span className={className}>{children}</span>;

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        title="Show the workings"
        className={`cursor-help underline decoration-dotted decoration-1 underline-offset-4 ${className}`}
      >
        {children}
      </button>
      {open && (
        <span
          id={id}
          role="dialog"
          className="kb-card absolute left-0 top-full z-40 mt-1 block w-72 max-w-[80vw] px-3 py-2 text-left text-[11px] font-normal shadow-lg"
        >
          <span className="mb-1 block text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">How this is worked out</span>
          {workings.map((w, i) => (
            <span key={i} className="flex justify-between gap-3 py-0.5">
              <span className="text-[var(--kb-text-dim)]">{w.label}</span>
              <span className="tabular-nums text-[var(--kb-text)]">{w.value}</span>
            </span>
          ))}
          {note && <span className="mt-1 block border-t border-[var(--kb-panel-border)] pt-1 text-[var(--kb-text-dim)]">{note}</span>}
        </span>
      )}
    </span>
  );
}
