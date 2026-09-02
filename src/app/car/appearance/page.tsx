import { getPlatformColorSkin, COLOR_SKIN_LABELS, type ColorSkin } from "@/lib/ai/model";
import { setColorSkinAction } from "./actions";

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
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Appearance</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        The dashboard&apos;s color skin, platform-wide — applies to every tenant. Safe to flip
        any time, no redeploy needed. Sidebar navigation stays the same neutral dark tone in
        every skin; this only changes accent colors and stat-tile tints.
      </p>

      <div className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
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
                <form action={setColorSkinAction}>
                  <input type="hidden" name="skin" value={s.id} />
                  <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                    Use this
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
