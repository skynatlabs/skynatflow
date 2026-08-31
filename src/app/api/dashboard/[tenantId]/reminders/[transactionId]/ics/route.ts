// A standard .ics calendar file for one reminder — opens directly in
// Google Calendar, Outlook, or Apple Calendar (all three import .ics
// natively), which is a genuinely working two-way sync path without
// needing an OAuth integration with any one calendar provider. Full
// live two-way sync (auto-updating if the reminder date changes) would
// need Google/Microsoft OAuth — this is the real, working v1.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";

function toIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; transactionId: string }> }
) {
  const { tenantId, transactionId } = await params;
  await requireTenantAccess(tenantId);

  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { party: true, tenant: true },
  });
  if (!tx || tx.tenantId !== tenantId || !tx.nextFollowUpAt) {
    return NextResponse.json({ error: "No reminder set" }, { status: 404 });
  }

  const docType = tx.type === "QUOTE" ? "quote" : "invoice";
  const summary = escapeIcsText(`Follow up with ${tx.party.name} — ${docType}`);
  const description = escapeIcsText(tx.followUpNote || `Follow up on this ${docType} from ${tx.tenant.name}.`);
  const dtStart = toIcsDate(tx.nextFollowUpAt);
  const dtStamp = toIcsDate(new Date());

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//flow by Skynat//Reminders//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:flow-reminder-${tx.id}@flow.skynat.co`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="reminder-${tx.id}.ics"`,
    },
  });
}
