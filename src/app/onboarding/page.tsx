// Form-based onboarding for now — the conversational AI version from the
// strategic report (Section 12) replaces this once ANTHROPIC_API_KEY is
// live (Phase 0 checkpoint). This still delivers the core promise: pick a
// niche, get the right skin, no blank screen.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { FlowMark } from "@/components/FlowMark";
import { createTenantAction } from "./actions";
import PrefillAssist from "./PrefillAssist";
import PdfPrefillAssist from "./PdfPrefillAssist";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const theme = cookieStore.get("kb-theme")?.value === "dark" ? "dark" : "light";

  return (
    <div className="kb-shell flex min-h-screen items-center justify-center p-8" data-theme={theme}>
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2">
          <FlowMark size={34} />
          <span className="kb-gradient-text text-2xl font-extrabold">Set up your workspace</span>
        </div>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
          One engine, seven skins — pick the one that matches your business and
          the whole platform reconfigures around it.
        </p>

        <PrefillAssist />
        <PdfPrefillAssist />

        <form action={createTenantAction} className="kb-card mt-6 space-y-4 p-6">
          <input type="hidden" name="catalogItemsJson" id="catalogItemsJson-input" />
          <input type="hidden" name="customerJson" id="customerJson-input" />
          <input type="hidden" name="logoDataUrl" id="logoDataUrl-input" />
          <div>
            <label className={labelClass}>Business name</label>
            <input id="businessName-input" name="businessName" required className={inputClass} placeholder="Demo Solar Co" />
          </div>

          <div>
            <label className={labelClass}>What kind of business is this?</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {Object.values(NICHE_CONFIGS).map((n, i) => (
                <label
                  key={n.skin}
                  className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--kb-panel-border)] p-3 text-xs transition has-[:checked]:border-[var(--kb-accent-a)]"
                  style={{ background: "var(--kb-tint-violet)" }}
                >
                  <input
                    id={`niche-${n.skin}`}
                    type="radio"
                    name="niche"
                    value={n.skin}
                    defaultChecked={i === 0}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-semibold text-[var(--kb-text)]">{n.label}</span>
                    <span className="block text-[var(--kb-text-dim)]">{n.tagline}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>
              WhatsApp number{" "}
              <span className="text-[var(--kb-text-dim)]">(for your daily briefing)</span>
            </label>
            <input name="ownerPhone" className={inputClass} placeholder="+27821234567" />
          </div>

          <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
            Create workspace
          </button>
        </form>
      </div>
    </div>
  );
}
