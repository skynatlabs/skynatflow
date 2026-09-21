// The authentication trail.
//
// Every enterprise security questionnaire asks for three things by name:
// authentication events, role changes, and administrative actions. The second
// and third go to AuditLog, which is scoped to a workspace. The first cannot
// — a sign-in happens before any workspace is chosen, and a failed one may
// not belong to an account that exists.
//
// So this is its own trail, and it records attempts as well as successes.
// "Somebody tried this address forty times from three countries" is the
// signal worth having, and it is invisible if only successes are kept.

import { prisma } from "@/lib/db";

export type AuthEventKind = "SIGNIN_OK" | "SIGNIN_FAILED" | "SIGNIN_BLOCKED" | "SIGNUP";

export const AUTH_EVENT_LABELS: Record<AuthEventKind, string> = {
  SIGNIN_OK: "Signed in",
  SIGNIN_FAILED: "Failed sign-in",
  SIGNIN_BLOCKED: "Blocked — too many attempts",
  SIGNUP: "Account created",
};

/**
 * Write one down.
 *
 * Never throws into the caller: a failure to record an event must not be able
 * to stop somebody signing in. A missing line in the trail is a smaller
 * problem than an owner locked out of their business because a log table was
 * full.
 */
export async function recordAuthEvent(params: {
  email: string;
  kind: AuthEventKind;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  at?: Date;
}): Promise<void> {
  try {
    await prisma.authEvent.create({
      data: {
        email: params.email.trim().toLowerCase(),
        kind: params.kind,
        userId: params.userId ?? null,
        ip: params.ip ?? null,
        // Long enough to identify a browser, short enough not to store an essay.
        userAgent: params.userAgent?.slice(0, 400) ?? null,
        at: params.at ?? new Date(),
      },
    });
  } catch (err) {
    console.error("[auth] could not record an authentication event:", err);
  }
}

export interface AuthEventRow {
  id: string;
  kind: AuthEventKind;
  label: string;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}

/**
 * What has happened on this account lately, for the person who owns it.
 *
 * Shown to them rather than only to us, because the person best placed to
 * notice a sign-in they did not make is the person whose account it is.
 */
export async function recentAuthEvents(email: string, take = 20): Promise<AuthEventRow[]> {
  const rows = await prisma.authEvent.findMany({
    where: { email: email.trim().toLowerCase() },
    orderBy: { at: "desc" },
    take,
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as AuthEventKind,
    label: AUTH_EVENT_LABELS[row.kind as AuthEventKind] ?? row.kind,
    ip: row.ip,
    userAgent: row.userAgent,
    at: row.at,
  }));
}

/** Older than this and it is neither useful nor ours to keep. */
export async function purgeOldAuthEvents(olderThanDays = 180, now = new Date()): Promise<number> {
  const { count } = await prisma.authEvent.deleteMany({
    where: { at: { lt: new Date(now.getTime() - olderThanDays * 86_400_000) } },
  });
  return count;
}
