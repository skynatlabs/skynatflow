// The three PA voice plans and the metering behind them. A tenant never
// gets cut off — once their period's premium-voice allowance is spent,
// synthesizePaVoice() just returns { engine: "browser" } instead of
// throwing, so "Unlimited" can be advertised honestly: it never stops,
// it just stops being the paid voice once you've used your daily share.

export type VoicePlan = "free" | "starter" | "unlimited";

export const VOICE_PLAN_LABELS: Record<VoicePlan, string> = {
  free: "Free",
  starter: "Starter ($3/mo)",
  unlimited: "Unlimited PA voice ($10/mo)",
};

export const VOICE_PLAN_DESCRIPTIONS: Record<VoicePlan, string> = {
  free: "20,000 premium voice characters per month, then free browser voice for the rest of the month.",
  starter: "60,000 premium voice characters per month, then free browser voice for the rest of the month.",
  unlimited: "10,000 premium voice characters per day, then free browser voice for the rest of that day — never actually stops working.",
};

interface PlanAllowance {
  charsPerPeriod: number;
  period: "month" | "day";
}

const PLAN_ALLOWANCE: Record<VoicePlan, PlanAllowance> = {
  free: { charsPerPeriod: 20_000, period: "month" },
  starter: { charsPerPeriod: 60_000, period: "month" },
  unlimited: { charsPerPeriod: 10_000, period: "day" },
};

export function periodKeyFor(plan: VoicePlan, now: Date): string {
  const allowance = PLAN_ALLOWANCE[plan];
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (allowance.period === "day") {
    const d = String(now.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return `${y}-${m}`;
}

export function allowanceFor(plan: VoicePlan): number {
  return PLAN_ALLOWANCE[plan].charsPerPeriod;
}
