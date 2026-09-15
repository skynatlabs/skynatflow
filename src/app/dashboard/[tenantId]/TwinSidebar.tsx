"use client";

// The Admina twin sidebar: a 72px icon rail of categories, plus a 248px panel
// showing the selected category's pages.
//
// Every class name here is the template's own (.twin-sidebar, .twin-rail,
// .rail-icon, .twin-panel, .twin-menu, .twin-backdrop), so the vendored
// stylesheet in src/app/admina.css drives the appearance directly rather than
// this component re-describing it in Tailwind. The only thing added on top is
// the behaviour the static template did in jQuery: which rail category is
// selected, and the mobile drawer.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export interface TwinNavItem {
  href: string;
  label: string;
  badge?: number;
  /** Nothing here for this workspace yet: folded under More, never removed. */
  quiet?: boolean;
}

export interface TwinNavGroup {
  key: string;
  label: string;
  /** Inline SVG rather than the template's icon font, which isn't bundled. */
  icon: React.ReactNode;
  items: TwinNavItem[];
}

export function TwinSidebar({
  groups,
  brand,
  workspaceName,
  footer,
}: {
  groups: TwinNavGroup[];
  brand: React.ReactNode;
  workspaceName: string;
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Which category the current page lives in — so landing on a deep link
  // opens the right panel rather than defaulting to the first one.
  const groupForPath = useMemo(() => {
    let best: { key: string; len: number } | null = null;
    for (const g of groups) {
      for (const item of g.items) {
        if (
          (pathname === item.href || pathname.startsWith(item.href + "/")) &&
          (!best || item.href.length > best.len)
        ) {
          best = { key: g.key, len: item.href.length };
        }
      }
    }
    return best?.key ?? groups[0]?.key;
  }, [pathname, groups]);

  const [activeGroup, setActiveGroup] = useState(groupForPath);

  // Follow the URL when it changes, and close the drawer behind a navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveGroup(groupForPath);
    setMobileOpen(false);
  }, [groupForPath, pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  const shown = groups.find((g) => g.key === activeGroup) ?? groups[0];

  return (
    <>
      <button
        type="button"
        className="twin-mobile-toggle"
        aria-label="Open menu"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <MenuGlyph />
      </button>

      <div
        className={`twin-backdrop${mobileOpen ? " show" : ""}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={`twin-sidebar${mobileOpen ? " is-open" : ""}`}
        aria-label="Primary navigation"
      >
        {/* ---------------------------------------------------- icon rail */}
        <div className="twin-rail">
          <span className="twin-rail__brand">{brand}</span>

          <div className="twin-rail__nav" role="tablist" aria-orientation="vertical">
            {groups.map((group) => {
              const selected = group.key === activeGroup;
              const pending = group.items.reduce((n, i) => n + (i.badge ?? 0), 0);
              return (
                <button
                  key={group.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`rail-icon${selected ? " active" : ""}`}
                  aria-label={group.label}
                  onClick={() => setActiveGroup(group.key)}
                >
                  {group.icon}
                  {pending > 0 && <span className="rail-badge">{pending > 9 ? "9+" : pending}</span>}
                  <span className="rail-tip">{group.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* -------------------------------------------------------- panel */}
        <div className="twin-panel">
          <div className="twin-panel__head">
            <span className="twin-panel__logo">skynat.ai</span>
            <button
              type="button"
              className="twin-panel__close"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <CloseGlyph />
            </button>
          </div>

          <p className="twin-panel__workspace">{workspaceName}</p>

          <div className="twin-panel__body">
            <ul className="twin-menu active" key={shown?.key}>
              {shown?.items.filter((item) => !item.quiet || pathname === item.href || pathname.startsWith(item.href + "/")).map((item) => {
                const current =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href} className={current ? "active" : undefined}>
                    <Link href={item.href} aria-current={current ? "page" : undefined}>
                      <span>{item.label}</span>
                      {item.badge ? <span className="twin-menu__badge">{item.badge}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {(() => {
              const folded = shown?.items.filter((item) => item.quiet && !(pathname === item.href || pathname.startsWith(item.href + "/"))) ?? [];
              if (folded.length === 0) return null;
              return (
                <details className="twin-more">
                  <summary>More ({folded.length})</summary>
                  <ul className="twin-menu active">
                    {folded.map((item) => (
                      <li key={item.href}>
                        <Link href={item.href}><span>{item.label}</span></Link>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })()}
          </div>

          <div className="twin-panel__foot">{footer}</div>
        </div>
      </aside>
    </>
  );
}

function MenuGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="22" height="22">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="20" height="20">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
