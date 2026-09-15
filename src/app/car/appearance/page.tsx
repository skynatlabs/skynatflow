import { getPlatformColorSkin, COLOR_SKIN_LABELS, type ColorSkin } from "@/lib/ai/model";

export default async function AdminAppearancePage() {
  const current = await getPlatformColorSkin();

  const skins: { id: ColorSkin; helpText: string; swatches: string[] }[] = [
    {
      id: "default",
      helpText: "Graphite sidebar, indigo/violet/cyan accents — the default palette.",
      swatches: ["#171725", "#4f46e5", "#0ea5e9"],
    },
    {
      id: "sunset",
      helpText: "Same dark neutral sidebar, but every accent, highlight, and stat tile shifts to a rich charcoal/amber/white palette instead of the default coral/violet.",
      swatches: ["#1c1108", "#d94a0a", "#f0871f"],
    },
    {
      id: "professional",
      helpText: "Clean, corporate look: teal accents on white/graphite, inspired by modern CRM dashboards. Has its own light and dark variant — toggle with the moon/sun switch.",
      swatches: ["#0f766e", "#14b8a6", "#134e4a"],
    },
    {
      id: "creative",
      helpText: "Bold, colorful gradients — pink, violet, and cyan accents over a rich dark canvas. Has its own light and dark variant.",
      swatches: ["#7c3aed", "#ec4899", "#06b6d4"],
    },
    {
      id: "futuristic",
      helpText: "Sci-fi glass look: cool cyan/electric-blue accents, crisp edges. Has its own light and dark variant.",
      swatches: ["#0ea5e9", "#22d3ee", "#0f172a"],
    },
    {
      id: "jewel",
      helpText: "Emerald, mango and magenta over a deep canvas — rich and saturated without going neon.",
      swatches: ["#059669", "#f59e0b", "#db2777"],
    },
    {
      id: "summer",
      helpText: "Cyan, blue, orange, yellow and pink as flat colour — no gradients anywhere, so everything reads crisply at small sizes.",
      swatches: ["#06b6d4", "#f97316", "#ec4899"],
    },
    {
      id: "admina",
      helpText:
        "Dense, data-first admin in blue and slate. The only skin that changes the navigation itself: a twin icon rail and panel grouped by what you are doing, instead of one long list.",
      swatches: ["#3b82f6", "#475569", "#0f172a"],
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Appearance</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        The dashboard&apos;s colour skin, platform-wide — applies to every tenant. Safe to flip
        any time, no redeploy needed. Most skins change only accent colours and stat-tile tints,
        leaving the sidebar the same neutral dark tone. Admina is the exception: it replaces the
        navigation itself with a twin icon rail.
      </p>

      {/* Disabled rather than removed. The skins and their CSS are all still
          here, and re-enabling the choice is a one-line change in
          getPlatformColorSkin — but seven half-maintained variations of the
          whole chrome was not a feature, it was seven ways for a page to look
          wrong. */}
      <div
        className="mt-6 rounded-md px-4 py-3 text-sm"
        style={{ background: "var(--kb-tint-blue)", color: "var(--kb-tint-blue-ink)" }}
      >
        <p>
          Admina is now the only look, and every page is designed and tested against it. The other
          skins below are kept but no longer selectable.
        </p>
        <p className="mt-1.5 opacity-90">
          What people can change is their own accent colour, from Appearance in their dashboard
          settings — their choice, not a platform-wide one.
        </p>
      </div>

      <div className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)] opacity-60">
        {skins.map((s) => {
          const isCurrent = current === s.id;
          return (
            <div key={s.id} className="flex items-center justify-between p-5">
              <div className="flex items-center gap-4">
                <div className="flex gap-1">
                  {s.swatches.map((c) => (
                    <span key={c} className="h-8 w-8 rounded-full border border-black/10" style={{ background: c }} />
                  ))}
                </div>
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{COLOR_SKIN_LABELS[s.id]}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">{s.helpText}</p>
                </div>
              </div>
              {isCurrent ? (
                <span className="kb-pill kb-pill-primary text-xs">Active</span>
              ) : (
                <span className="kb-pill text-xs text-[var(--kb-text-dim)]">Disabled</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
