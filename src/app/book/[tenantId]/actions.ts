"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createBooking, getBookingConfig, listAvailableSlots } from "@/lib/core/booking";

export async function bookSlotAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const slotIso = String(formData.get("slot") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!name || !phone || !slotIso) throw new Error("Name, phone, and a time slot are required.");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const config = getBookingConfig(tenant);

  // Re-derive available slots server-side and check the picked one is
  // still actually open — never trust a client-submitted timestamp as
  // valid without re-checking against current bookings (double-book race).
  const available = await listAvailableSlots(tenantId, config);
  const slot = available.find((s) => s.toISOString() === slotIso);
  if (!slot) throw new Error("That slot was just taken — please pick another.");

  await createBooking({
    tenantId,
    name,
    phone,
    startAt: slot,
    notes: notes || undefined,
    eventType: tenant.niche === "MEDICAL" ? "CONSULTATION" : "SITE_VISIT",
  });

  // The same form is used on the public page and inside an embedded frame.
  // Sending the frame to the full booking page would replace the widget with
  // a whole second copy of it inside the customer's website.
  const inFrame = String(formData.get("embed") ?? "") === "1";
  redirect(inFrame ? `/embed/${tenantId}/booking?booked=1` : `/book/${tenantId}?booked=1`);
}
