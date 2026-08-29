"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import MotionLink from "@/components/marketing/MotionLink";

const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/ai", label: "AI & Agents" },
  { href: "/case-studies", label: "Case Studies" },
  { href: "/benefits", label: "Benefits" },
  { href: "/compare", label: "Compare" },
  { href: "/integrations", label: "Integrations" },
];

export default function MarketingHeader() {
  const [industriesOpen, setIndustriesOpen] = useState(false);
  // Clicking pins the dropdown open regardless of the mouse — otherwise
  // moving the cursor away right after a click would immediately close it
  // via the hover-out handler, which defeats the point of a click-to-open.
  const [industriesPinned, setIndustriesPinned] = useState(false);
  const industriesRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileIndustriesOpen, setMobileIndustriesOpen] = useState(false);

  useEffect(() => {
    if (!industriesPinned) return;
    function handleOutsideClick(e: MouseEvent) {
      if (industriesRef.current && !industriesRef.current.contains(e.target as Node)) {
        setIndustriesOpen(false);
        setIndustriesPinned(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [industriesPinned]);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="sticky top-0 z-20 border-b border-[var(--kb-panel-border)] bg-[var(--kb-bg)]/90 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center" onClick={() => setMobileOpen(false)}>
          <Image src="/flow-logo.png" alt="flow" width={140} height={40} priority className="h-9 w-auto" />
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-[var(--kb-text-dim)] lg:flex">
          <div
            ref={industriesRef}
            className="relative"
            onMouseEnter={() => setIndustriesOpen(true)}
            onMouseLeave={() => {
              if (!industriesPinned) setIndustriesOpen(false);
            }}
          >
            <button
              type="button"
              className="flex items-center gap-1 py-3 hover:text-[var(--kb-text)]"
              onClick={() => {
                setIndustriesPinned((wasPinned) => {
                  setIndustriesOpen(!wasPinned);
                  return !wasPinned;
                });
              }}
            >
              Industries
              <span className="text-xs">&#9662;</span>
            </button>
            {/* No gap between trigger and panel — the pt-3 above and the
                immediately-adjacent panel below keep the hover area
                continuous, so moving the mouse down never crosses a dead
                zone that would fire onMouseLeave early. */}
            {industriesOpen && (
              <div className="kb-card absolute left-0 top-full grid w-64 grid-cols-1 gap-1 p-2">
                {Object.values(NICHE_CONFIGS).map((n) => (
                  <Link
                    key={n.skin}
                    href={`/industries/${n.skin.toLowerCase()}`}
                    className="rounded-md px-3 py-2 text-sm text-[var(--kb-text)] hover:bg-[var(--kb-panel)]"
                    onClick={() => {
                      setIndustriesOpen(false);
                      setIndustriesPinned(false);
                    }}
                  >
                    {n.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-[var(--kb-text)]">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="kb-pill kb-pill-ghost">Log in</Link>
          <MotionLink
            href="/signup"
            className="kb-pill kb-pill-primary"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
          >
            Get Started &rarr;
          </MotionLink>
        </div>

        {/* Mobile hamburger — the nav had no fallback at all below lg,
            meaning there was literally no way to navigate on mobile. */}
        <button
          type="button"
          aria-label="Toggle menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--kb-panel-border)] lg:hidden"
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span className="text-lg text-[var(--kb-text)]">{mobileOpen ? "✕" : "☰"}</span>
        </button>
      </div>

      {mobileOpen && (
        <nav className="border-t border-[var(--kb-panel-border)] px-6 py-4 lg:hidden">
          <div>
            <button
              type="button"
              className="flex w-full items-center justify-between py-2 text-sm font-medium text-[var(--kb-text)]"
              onClick={() => setMobileIndustriesOpen((v) => !v)}
            >
              Industries
              <span className="text-xs">{mobileIndustriesOpen ? "╲" : "╱"}</span>
            </button>
            {mobileIndustriesOpen && (
              <div className="ml-3 flex flex-col gap-1 border-l border-[var(--kb-panel-border)] pl-3">
                {Object.values(NICHE_CONFIGS).map((n) => (
                  <Link
                    key={n.skin}
                    href={`/industries/${n.skin.toLowerCase()}`}
                    className="py-1.5 text-sm text-[var(--kb-text-dim)]"
                    onClick={() => setMobileOpen(false)}
                  >
                    {n.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block py-2 text-sm font-medium text-[var(--kb-text)]"
              onClick={() => setMobileOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-3 flex items-center gap-3 border-t border-[var(--kb-panel-border)] pt-3">
            <Link href="/login" className="kb-pill kb-pill-ghost flex-1 justify-center">Log in</Link>
            <Link href="/signup" className="kb-pill kb-pill-primary flex-1 justify-center">Get Started &rarr;</Link>
          </div>
        </nav>
      )}
    </motion.header>
  );
}
