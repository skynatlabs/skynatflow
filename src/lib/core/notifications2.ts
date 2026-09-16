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
import { push } from "./push";

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

  const notification = await prisma.notification.create({
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

  // The phone, last and never blocking: a push service having a bad morning
  // must not stop the notification being recorded, which is the thing that
  // actually has to survive.
  void push({
    tenantId: params.tenantId,
    membershipId: params.membershipId ?? null,
    message: {
      title: params.title,
      // The body as written, which is already a nudge rather than an amount —
      // see push.ts. Nothing extra is added here.
      body: params.body,
      url: params.linkHref ?? `/dashboard/${params.tenantId}`,
      // One banner per kind of thing. Four "invoice overdue" notifications
      // stacked up is how somebody turns them off for good.
      tag: `${params.type}`,
    },
  }).catch(() => null);

  return notification;
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

export async function markNotificationRead(tenantId: string, notificationId: string) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.tenantId !== tenantId) throw new Error("Notification not found.");
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
