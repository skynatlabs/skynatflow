// The compliance watch — the one arc of the tick that does not use the model.
//
// Everything else the agent does proactively is a judgement call, and a model
// is the right tool for a judgement call. This is not one. "The CIPC annual
// return is 12 days overdue" is a fact with a date attached, and routing it
// through a language model buys nothing and costs three things that matter:
//
//   - it can be missed, because the model decides what is worth raising
//   - it costs a call per tenant per tick
//   - it stops working the moment the AI provider is out of credit, which is
//     exactly when a business would most like to still be warned that its
//     registration is lapsing
//
// So detection is arithmetic and the wording is a template. The model still
// has the full radar available as a tool, and will use it when someone asks a
// question — this arc is the floor beneath that, not a replacement for it.

import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/core/notifications2";
import { obligationRadar, type RadarLine, type ObligationState } from "@/lib/core/obligations";
import { observe } from "@/lib/agent/observations";

export interface ComplianceWatchOutcome {
  /** Obligations whose state worsened since the owner was last told. */
  raised: number;
  /** Lapsed obligations currently set to stop work. */
  blocking: number;
}

// Only a worsening is worth an interruption. Something moving from SOON back
// to SCHEDULED — because a date was corrected — is good news nobody needs a
// notification about.
const SEVERITY_OF_STATE: Record<ObligationState, number> = {
  SCHEDULED: 0,
  SOON: 1,
  DUE: 2,
  OVERDUE: 3,
};

function worsened(from: string | null, to: ObligationState): boolean {
  if (!from) return to !== "SCHEDULED";
  const previous = SEVERITY_OF_STATE[from as ObligationState] ?? 0;
  return SEVERITY_OF_STATE[to] > previous;
}

/**
 * One line of plain language per obligation.
 *
 * Written as a template rather than generated because these sentences are
 * read in a hurry, on a phone, by somebody who is already busy — and a
 * template that always says the date, the authority and the consequence beats
 * a generated sentence that is livelier and sometimes omits one of them.
 */
function describe(line: RadarLine): string {
  const who = line.authority ? ` (${line.authority})` : "";
  const when =
    line.daysUntil < 0
      ? `was due ${Math.abs(line.daysUntil)} day${Math.abs(line.daysUntil) === 1 ? "" : "s"} ago`
      : line.daysUntil === 0
        ? "is due today"
        : `is due in ${line.daysUntil} day${line.daysUntil === 1 ? "" : "s"}`;

  // On a contract the notice date is the real deadline, so say both — "act by
  // the 3rd, renews on the 1st of June" is the only version that is actually
  // actionable.
  const noticeNote =
    line.actionByAt.getTime() !== line.dueAt.getTime()
      ? ` Notice has to be given by ${line.actionByAt.toISOString().slice(0, 10)}; it renews on ${line.dueAt.toISOString().slice(0, 10)}.`
      : "";

  const subject = line.subject ? ` — ${line.subject.label}` : "";
  const because = line.consequence ? ` ${line.consequence}` : "";

  return `${line.title}${subject}${who} ${when}.${noticeNote}${because}`;
}

function titleFor(lines: RadarLine[]): string {
  const blocking = lines.filter((l) => l.blocksWork);
  if (blocking.length > 0) {
    return blocking.length === 1
      ? `${blocking[0].title} has lapsed — work is blocked`
      : `${blocking.length} lapsed items are blocking work`;
  }
  const critical = lines.filter((l) => l.severity === "CRITICAL");
  if (critical.length > 0) return `${critical[0].title} needs attention now`;
  return lines.length === 1 ? lines[0].title : `${lines.length} deadlines need attention`;
}

/**
 * Check one workspace's obligations and raise anything that has got worse.
 *
 * Notifies on a change of state rather than on the state itself, so a licence
 * that has been overdue for a fortnight is mentioned once rather than every
 * fifteen minutes — the failure mode that gets proactive features muted.
 */
export async function runComplianceWatch(
  tenantId: string,
  now: Date = new Date()
): Promise<ComplianceWatchOutcome> {
  const radar = await obligationRadar(tenantId, now);
  const live = [...radar.overdue, ...radar.due, ...radar.soon];
  if (live.length === 0) return { raised: 0, blocking: 0 };

  const rows = await prisma.obligation.findMany({
    where: { id: { in: live.map((l) => l.id) } },
    select: { id: true, lastNotifiedState: true },
  });
  const lastState = new Map(rows.map((r) => [r.id, r.lastNotifiedState]));

  const fresh = live.filter((l) => worsened(lastState.get(l.id) ?? null, l.state));
  if (fresh.length === 0) return { raised: 0, blocking: radar.blocking.length };

  // Worst first: whoever reads only the first line should read the worst one.
  fresh.sort(
    (a, b) =>
      Number(b.blocksWork) - Number(a.blocksWork) ||
      SEVERITY_OF_STATE[b.state] - SEVERITY_OF_STATE[a.state] ||
      a.daysUntil - b.daysUntil
  );

  // Writes to the bus rather than notifying directly. A deterministic watcher
  // with no model behind it still has to compete for attention on the same
  // terms as everything else — a private channel to the owner is exactly the
  // privilege the coordination layer exists to remove.
  //
  // The direct notification stays for anything that stops work: an expired
  // driving permit is not a ranking question, and holding it back because
  // four higher-scoring things happened today would be indefensible.
  for (const line of fresh) {
    await observe({
      tenantId,
      officer: "SYSTEM",
      headline: describe(line),
      dedupeKey: `obligation:${line.id}`,
      subjectType: "obligation",
      subjectId: line.id,
      // Severity stands in for money until an obligation carries an amount.
      moneyCents: line.severity === "CRITICAL" ? 50_000_00 : line.severity === "HIGH" ? 15_000_00 : null,
      confidence: 100, // a date is a date
      urgentBy: line.actionByAt,
      proposedAction: line.consequence,
      evidence: [
        { label: "Due", value: line.dueAt.toISOString().slice(0, 10) },
        ...(line.authority ? [{ label: "Required by", value: line.authority }] : []),
      ],
    });
  }

  const blocking = fresh.filter((l) => l.blocksWork);
  if (blocking.length > 0) {
    await createNotification({
      tenantId,
      type: "GENERAL",
      title: titleFor(blocking),
      body: blocking.map(describe).join("\n\n").slice(0, 1500),
    });
  }

  await prisma.obligation.updateMany({
    where: { id: { in: fresh.map((l) => l.id) } },
    data: { lastNotifiedAt: now },
  });
  // updateMany cannot set a different value per row, and the state differs per
  // obligation, so the state itself is written individually. The set is small
  // by construction — only what changed state since the last tick.
  await Promise.all(
    fresh.map((l) =>
      prisma.obligation.update({
        where: { id: l.id },
        data: { lastNotifiedState: l.state },
      })
    )
  );

  return { raised: fresh.length, blocking: radar.blocking.length };
}
