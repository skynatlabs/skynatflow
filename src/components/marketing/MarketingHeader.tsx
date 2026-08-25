"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { FlowMark } from "@/components/FlowMark";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import MotionLink from "@/components/marketing/MotionLink";

const NAV_LINKS = [
  { href: "/about", label: "About" },
  { href: "/ai", label: "AI & Agents" },
  { href: "/case-studies", label: "Case Studies" },
  { href: "/benefits", label: "Benefits" },
  { href: "/compare", label: "Compare" },
  { href: "/integrations", label: "Integrations" },
];

export default function MarketingHeader() {
  const [industriesOpen, setIndustriesOpen] = useState(false);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="sticky top-0 z-20 border-b border-[var(--kb-panel-border)] bg-[var(--kb-bg)]/90 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <FlowMark size={30} />
          <span className="text-lg font-bold text-[var(--kb-text)]">flow</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-[var(--kb-text-dim)] lg:flex">
          <div
            className="relative"
            onMouseEnter={() => setIndustriesOpen(true)}
            onMouseLeave={() => setIndustriesOpen(false)}
          >
            <button
              type="button"
              className="flex items-center gap-1 hover:text-[var(--kb-text)]"
              onClick={() => setIndustriesOpen((v) => !v)}
            >
              Industries
              <span className="text-xs">&#9662;</span>
            </button>
            {industriesOpen && (
              <div className="kb-card absolute left-0 top-full mt-2 grid w-64 grid-cols-1 gap-1 p-2">
                {Object.values(NICHE_CONFIGS).map((n) => (
                  <Link
                    key={n.skin}
                    href={`/industries/${n.skin.toLowerCase()}`}
                    className="rounded-md px-3 py-2 text-sm text-[var(--kb-text)] hover:bg-[var(--kb-panel)]"
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

        <div className="flex items-center gap-3">
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
      </div>
    </motion.header>
  );
}
