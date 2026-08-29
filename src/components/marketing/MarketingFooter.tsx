import Link from "next/link";
import Image from "next/image";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/ai", label: "AI & Agents" },
      { href: "/benefits", label: "Benefits" },
      { href: "/integrations", label: "Integrations" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About Us" },
      { href: "/case-studies", label: "Case Studies" },
    ],
  },
  {
    heading: "Get started",
    links: [
      { href: "/signup", label: "Sign up" },
      { href: "/login", label: "Log in" },
    ],
  },
];

export default function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--kb-panel-border)] py-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div>
            <Image src="/flow-logo.png" alt="flow" width={110} height={32} className="h-7 w-auto" />
            <p className="mt-3 max-w-[20ch] text-xs text-[var(--kb-text-dim)]">
              By Skynat. One platform to run your entire business.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
                {col.heading}
              </p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-[var(--kb-text-dim)]">
                {col.links.map((l) => (
                  <Link key={l.href} href={l.href} className="hover:text-[var(--kb-text)]">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 border-t border-[var(--kb-panel-border)] pt-6 text-sm text-[var(--kb-text-dim)]">
          &copy; {new Date().getFullYear()} Skynat. Built for SMEs, not scaled down from enterprise.
        </div>
      </div>
    </footer>
  );
}
