// The first screen after signing up.
//
// Two questions — what the business is called, and what it does — and an
// offer to read both off something they already have. Everything else that
// comes with that document is carried into the steps that ask about it.

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { FlowMark } from "@/components/FlowMark";
import { BusinessStep } from "./BusinessStep";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Somebody who started and stopped halfway comes back to where they were,
  // rather than to a second empty workspace.
  const unfinished = await prisma.membership.findFirst({
    where: { userId: session.user.id, role: "OWNER", tenant: { onboardedAt: null } },
    orderBy: { createdAt: "desc" },
    select: { tenant: { select: { id: true, onboardingStep: true } } },
  });
  if (unfinished?.tenant) {
    redirect(`/onboarding/${unfinished.tenant.id}/${unfinished.tenant.onboardingStep ?? "details"}`);
  }

  const niches = Object.values(NICHE_CONFIGS).map((n) => ({ skin: n.skin, label: n.label, tagline: n.tagline }));

  return (
    <div className="kb-shell kb-warm-loud min-h-screen" data-theme="light" data-skin="admina">
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <div className="flex items-center gap-2">
          <FlowMark size={30} />
          <span className="text-lg font-bold text-[var(--kb-text)]">skynat.ai</span>
        </div>
        <h1 className="mt-6 text-3xl font-semibold text-[var(--kb-text)]">Let&apos;s get your business in.</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--kb-text-dim)]">
          Hand me something you already have — your registration certificate, an invoice you sent last month, your price list, or just
          your website. I will read it and set the place up around it. Nothing is saved until you have seen it.
        </p>

        <div className="mt-6">
          <BusinessStep niches={niches} />
        </div>
      </div>
    </div>
  );
}
