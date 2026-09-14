"use client";

// Responsive shell for the dashboard chrome.
//
// The sidebar was a fixed 256px column with no mobile handling at all, which
// on a 375px phone left 119px for the actual page. On large screens it stays
// exactly as it was; below that it becomes a drawer behind a menu button.
//
// The nav itself is still rendered on the server and handed in as children —
// only the open/closed state lives here, so none of the per-niche nav logic
// had to move to the client.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MenuIcon, CloseIcon } from "@/components/icons";

export function SidebarShell({
  sidebar,
  topbar,
  children,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating from inside the drawer should close it; otherwise the new page
  // renders underneath a drawer the user has to dismiss by hand.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  // A drawer that scrolls the page behind it feels broken on touch.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Backdrop — below lg only, and only while open. */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-[17rem] shrink-0 flex-col p-5 transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:translate-x-0 motion-reduce:transition-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--kb-navy)" }}
        aria-hidden={!open ? undefined : false}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="absolute right-3 top-3 rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        {sidebar}
      </aside>

      <div className="flex min-h-dvh flex-1 flex-col" style={{ background: "var(--kb-bg)" }}>
        <div className="sticky top-0 z-20 flex items-center gap-1 border-b" style={{ background: "var(--kb-panel)", borderColor: "var(--kb-panel-border)" }}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="ml-2 shrink-0 rounded-lg p-2.5 text-[var(--kb-text-dim)] hover:bg-black/[0.04] hover:text-[var(--kb-text)] lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">{topbar}</div>
        </div>
        {/* kb-dock-host reserves the strip the command bar floats over, so
            the last row of any page stays reachable rather than sitting
            underneath it. */}
        <div className="kb-dock-host min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}
