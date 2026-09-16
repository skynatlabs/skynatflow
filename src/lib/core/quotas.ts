// What one workspace may use.
//
// Two different things get called a limit and they need opposite treatment.
//
// A rate limit protects the platform from one caller in a loop, and it should
// be blunt, cheap and unmissable. That already exists on API keys.
//
// A quota is about fair use of shared cost — the model calls, the messages,
// the storage. Getting this wrong in the obvious direction is worse than not
// having it: a business that hits a wall mid-invoice on a Friday afternoon
// does not read the explanation, they phone somebody and then they leave.
//
// So the rule here is that a quota never stops work a person is doing. It
// stops the things that run on their own — the overnight sweeps, the
// proactive drafting, the bulk sends — and it says so early, twice, before it
// stops anything. That is the same principle the agent's spending cap
// already uses, generalised.

import { prisma } from "@/lib/db";

export type Meter = "ai-calls" | "messages" | "documents" | "storage";

export interface MeterDef {
  key: Meter;
  label: string;
  /** What is actually being shared. */
  why: string;
  /** Generous by design. Almost nobody should see these. */
  monthlyAllowance: number;
  unit: string;
}

export const METERS: MeterDef[] = [
  {
    key: "ai-calls",
    label: "Agent work",
    why: "Every question and every overnight sweep costs real money at a model provider.",
    monthlyAllowance: 5_000,
    unit: "runs",
  },
  {
    key: "messages",
    label: "Messages out",
    why: "Email and WhatsApp are paid for per message.",
    monthlyAllowance: 10_000,
    unit: "messages",
  },
  {
    key: "documents",
    label: "Documents",
    why: "Quotes, invoices and agreements are cheap to keep; the count is here so nothing is a surprise.",
    monthlyAllowance: 50_000,
    unit: "documents",
  },
  {
    key: "storage",
    label: "Files and photographs",
    why: "Receipt photographs and signed documents are the bulk of what a workspace stores.",
    monthlyAllowance: 5_000,
    unit: "MB",
  },
];

export const METER_BY_KEY: Record<string, MeterDef> = Object.fromEntries(METERS.map((meter) => [meter.key, meter]));

export interface Usage {
  meter: Meter;
  label: string;
  used: number;
  allowance: number;
  unit: string;
  percent: number;
  /** "fine" | "getting close" | "over" — words, not a colour. */
  standing: "fine" | "getting-close" | "over";
  note: string;
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * What this workspace has used this month.
 *
 * Counted from the records rather than from a counter that is incremented
 * somewhere, because a counter and reality drift apart within a week and the
 * one nobody is looking at is always the counter.
 */
export async function usage(tenantId: string, now = new Date()): Promise<Usage[]> {
  const since = monthStart(now);

  const [aiRuns, messages, documents, receipts] = await Promise.all([
    prisma.agentRun.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.outboundEmail.count({ where: { tenantId, sentAt: { gte: since } } }),
    prisma.transaction.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.expense.count({ where: { tenantId, receiptDataUrl: { not: null }, createdAt: { gte: since } } }),
  ]);

  // A base64 receipt photograph runs about 300KB once encoded. An estimate,
  // and labelled as one rather than presented as a measurement.
  const storageMb = Math.round(receipts * 0.3);

  const counts: Record<Meter, number> = {
    "ai-calls": aiRuns,
    messages,
    documents,
    storage: storageMb,
  };

  return METERS.map((meter) => {
    const used = counts[meter.key];
    const percent = Math.round((used / meter.monthlyAllowance) * 100);
    const standing = percent >= 100 ? "over" : percent >= 80 ? "getting-close" : "fine";

    return {
      meter: meter.key,
      label: meter.label,
      used,
      allowance: meter.monthlyAllowance,
      unit: meter.unit,
      percent,
      standing,
      note:
        standing === "over"
          ? `Over the month's allowance. Work you start yourself carries on as normal — what stops is the overnight sweeps and anything that would have run on its own.`
          : standing === "getting-close"
            ? `${percent}% of the month used. Nothing changes yet; this is the warning rather than the wall.`
            : meter.why,
    };
  });
}

/**
 * May something that runs on its own start?
 *
 * Deliberately never asked of a person's own request. Somebody sitting at
 * their desk being told the workspace is out of allowance mid-question is a
 * worse outcome than the cost of answering them, every time.
 */
export async function mayRunUnattended(tenantId: string, meter: Meter, now = new Date()): Promise<{ allowed: boolean; reason: string | null }> {
  const rows = await usage(tenantId, now);
  const row = rows.find((candidate) => candidate.meter === meter);
  if (!row) return { allowed: true, reason: null };

  if (row.standing === "over") {
    return {
      allowed: false,
      reason: `This workspace has used ${row.used.toLocaleString()} ${row.unit} of ${row.label.toLowerCase()} this month, which is the whole allowance. Anything you ask for yourself still runs; this was something that would have run on its own.`,
    };
  }
  return { allowed: true, reason: null };
}

/** The one line for a settings screen, so nothing is ever a surprise. */
export async function usageSummary(tenantId: string, now = new Date()): Promise<string> {
  const rows = await usage(tenantId, now);
  const over = rows.filter((row) => row.standing === "over");
  const close = rows.filter((row) => row.standing === "getting-close");

  if (over.length > 0) return `Over the allowance on ${over.map((row) => row.label.toLowerCase()).join(" and ")}. Nothing you do yourself is affected.`;
  if (close.length > 0) return `Getting close on ${close.map((row) => row.label.toLowerCase()).join(" and ")}.`;
  return "Comfortably inside the month's allowances.";
}
