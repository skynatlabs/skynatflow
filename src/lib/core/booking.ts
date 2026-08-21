// Public booking page — Calendly-class feature, but the slot ends up as
// a normal Event row on the exact same customer timeline as everything
// else, not a parallel appointments system.

import { prisma } from "@/lib/db";
import { createParty, findPartyByPhone } from "@/lib/core/parties";
import { PartyRole } from "@prisma/client";

export interface BookingConfig {
  enabled: boolean;
  workDays: number[]; // 0=Sun..6=Sat
  startHour: number; // 24h
  endHour: number;
  slotMins: number;
}

export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  enabled: false,
  workDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
  slotMins: 60,
};

export function getBookingConfig(tenant: { bookingConfig: unknown }): BookingConfig {
  if (!tenant.bookingConfig) return DEFAULT_BOOKING_CONFIG;
  return { ...DEFAULT_BOOKING_CONFIG, ...(tenant.bookingConfig as Partial<BookingConfig>) };
}

export async function setBookingConfig(tenantId: string, config: BookingConfig) {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { bookingConfig: config as unknown as object },
  });
}

// Next N days of open slots, minus anything already booked (an Event with
// a scheduledAt on this tenant). Deliberately simple — no per-slot
// capacity beyond "one booking per slot," no buffer time, no timezones
// beyond server-local — a v1 booking page, not a full scheduling engine.
export async function listAvailableSlots(
  tenantId: string,
  config: BookingConfig,
  daysAhead = 14
): Promise<Date[]> {
  if (!config.enabled) return [];

  const now = new Date();
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + daysAhead);

  const booked = await prisma.event.findMany({
    where: { tenantId, scheduledAt: { gte: now, lte: rangeEnd } },
    select: { scheduledAt: true },
  });
  const bookedTimes = new Set(booked.map((b) => b.scheduledAt?.getTime()));

  const slots: Date[] = [];
  for (let d = new Date(now); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    if (!config.workDays.includes(d.getDay())) continue;
    for (let hour = config.startHour; hour < config.endHour; hour += config.slotMins / 60) {
      const slot = new Date(d);
      slot.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
      if (slot <= now) continue;
      if (bookedTimes.has(slot.getTime())) continue;
      slots.push(slot);
    }
  }
  return slots;
}

export async function createBooking(params: {
  tenantId: string;
  name: string;
  phone: string;
  startAt: Date;
  notes?: string;
  eventType: "CONSULTATION" | "SITE_VISIT";
}) {
  let party = await findPartyByPhone(params.tenantId, params.phone);
  if (!party) {
    party = await createParty({
      tenantId: params.tenantId,
      role: params.eventType === "CONSULTATION" ? PartyRole.PATIENT : PartyRole.CUSTOMER,
      name: params.name,
      phone: params.phone,
    });
  }

  return prisma.event.create({
    data: {
      tenantId: params.tenantId,
      partyId: party.id,
      type: params.eventType,
      scheduledAt: params.startAt,
      notes: params.notes,
    },
  });
}
