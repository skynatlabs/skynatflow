// The shared in-dashboard notification center — every alert channel
// (dashboard bell, WhatsApp to the assigned salesperson, mobile push once
// that exists) fans out from one call here, so there's a single record of
// "the business was actually told," not a different history per channel.
//
// Named notifications2.ts because notifications.ts already exists (the
// hot-lead email alert) — kept separate rather than risking a rename
// touching an existing, working import elsewhere.

import { prisma } from "@/lib/db";
import { NotificationType } from "@prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";

export async function createNotification(params: {
  tenantId: string;
  membershipId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  linkHref?: string;
  whatsappTo?: string | null; // if set, also alerts this number
}) {
  let sentViaWhatsApp = false;
  if (params.whatsappTo) {
    await sendWhatsAppMessage({ to: params.whatsappTo, body: `${params.title}: ${params.body}` });
    sentViaWhatsApp = true;
  }

  return prisma.notification.create({
    data: {
      tenantId: params.tenantId,
      membershipId: params.membershipId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      linkHref: params.linkHref,
      sentViaWhatsApp,
    },
  });
}

export async function listNotifications(tenantId: string, membershipId?: string) {
  return prisma.notification.findMany({
    where: {
      tenantId,
      OR: [{ membershipId: null }, ...(membershipId ? [{ membershipId }] : [])],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function unreadCount(tenantId: string, membershipId?: string) {
  return prisma.notification.count({
    where: {
      tenantId,
      isRead: false,
      OR: [{ membershipId: null }, ...(membershipId ? [{ membershipId }] : [])],
    },
  });
}

export async function markNotificationRead(notificationId: string) {
  return prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
}

export async function markAllRead(tenantId: string, membershipId?: string) {
  return prisma.notification.updateMany({
    where: { tenantId, isRead: false, OR: [{ membershipId: null }, ...(membershipId ? [{ membershipId }] : [])] },
    data: { isRead: true },
  });
}

// Resolves who to WhatsApp-alert for a given tenant — the OWNER
// membership's user phone, same fallback used by the existing hot-lead
// email alert (src/lib/core/notifications.ts), just for WhatsApp instead.
export async function resolveOwnerPhone(tenantId: string): Promise<string | null> {
  const owner = await prisma.membership.findFirst({
    where: { tenantId, role: "OWNER" },
    include: { user: true },
  });
  return owner?.user.phone ?? null;
}
