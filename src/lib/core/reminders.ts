// Automated appointment reminders — the single highest-leverage move
// against the no-show research (no-shows cost individual practices
// $150K-$1M/year, and 60-70% of them come from a small repeat-offender
// group). Fires at two fixed marks — 48h and 2h before — reusing the
// booking Event's own scheduledAt, no separate appointments system.

import { EventType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";

const APPOINTMENT_TYPES: EventType[] = [EventType.CONSULTATION, EventType.SITE_VISIT];

export type ReminderMark = "48h" | "2h";

function markerFor(eventId: string, mark: ReminderMark) {
  return `reminder:${mark}:${eventId}`;
}

async function alreadySent(eventId: string, mark: ReminderMark) {
  const existing = await prisma.event.findFirst({
    where: { type: EventType.FOLLOW_UP_SENT, notes: markerFor(eventId, mark) },
  });
  return existing != null;
}

// Appointments due within [markHours - windowMinutes, markHours] from now
// that haven't already had this specific reminder sent — a narrow window
// so the cron (run hourly) fires each reminder once, not on every run.
async function dueAppointments(markHours: number, windowMinutes = 65) {
  const now = new Date();
  const windowStart = new Date(now.getTime() + markHours * 3600000 - windowMinutes * 60000);
  const windowEnd = new Date(now.getTime() + markHours * 3600000);

  return prisma.event.findMany({
    where: {
      type: { in: APPOINTMENT_TYPES },
      scheduledAt: { gte: windowStart, lte: windowEnd },
    },
    include: { party: true },
  });
}

export async function sendDueReminders(mark: ReminderMark): Promise<number> {
  const markHours = mark === "48h" ? 48 : 2;
  const appointments = await dueAppointments(markHours);
  let sent = 0;

  for (const appt of appointments) {
    if (!appt.party?.phone) continue;
    if (await alreadySent(appt.id, mark)) continue;

    const when = appt.scheduledAt!.toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const body =
      mark === "48h"
        ? `Hi ${appt.party.name}! Just a reminder — you're booked in for ${when}. Reply if you need to reschedule.`
        : `Hi ${appt.party.name}, quick reminder your appointment is at ${when} — see you soon!`;

    await sendWhatsAppMessage({ to: appt.party.phone, body });

    await prisma.event.create({
      data: {
        tenantId: appt.tenantId,
        partyId: appt.partyId,
        type: EventType.FOLLOW_UP_SENT,
        notes: markerFor(appt.id, mark),
      },
    });

    sent++;
  }

  return sent;
}
