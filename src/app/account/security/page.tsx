import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { generateTotpSecret, totpUri } from "@/lib/auth/totp";
import { recentAuthEvents } from "@/lib/auth/events";
import { confirmTotpSetupAction, disableTotpAction } from "./actions";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export default async function SecuritySettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  const signIns = await recentAuthEvents(user.email);

  const newSecret = user.totpEnabled ? null : generateTotpSecret();
  const uri = newSecret ? totpUri(newSecret, user.email) : null;

  return (
    <main className="mx-auto max-w-md p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Two-factor authentication</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        An extra code from your phone at login, on top of your password.
      </p>

      {user.totpEnabled ? (
        <div className="kb-card mt-6 p-6">
          <p className="text-sm font-semibold text-[var(--kb-tint-mint-ink)]">✓ 2FA is enabled</p>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            You&apos;ll be asked for a code from your authenticator app every time you sign in.
          </p>
          <form action={disableTotpAction} className="mt-4">
            <button type="submit" className="kb-pill text-xs">
              Disable 2FA
            </button>
          </form>
        </div>
      ) : (
        <div className="kb-card mt-6 space-y-4 p-6">
          <div>
            <p className="text-sm font-medium text-[var(--kb-text)]">1. Add this key to your authenticator app</p>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
              Google Authenticator, Authy, 1Password — search for &ldquo;enter setup key manually&rdquo;.
            </p>
            <code className="mt-2 block break-all rounded-lg bg-black/5 px-3 py-2 text-xs text-[var(--kb-text)]">
              {newSecret}
            </code>
            {uri && (
              <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
                Or paste this setup link into an app that accepts one:{" "}
                <span className="break-all font-mono">{uri}</span>
              </p>
            )}
          </div>

          <form action={confirmTotpSetupAction}>
            <input type="hidden" name="secret" value={newSecret ?? ""} />
            <label className="block text-sm font-medium text-[var(--kb-text)]">
              2. Enter the 6-digit code it shows
            </label>
            <input name="token" inputMode="numeric" required placeholder="123456" className={inputClass} />
            <button type="submit" className="kb-pill kb-pill-primary mt-4 w-full justify-center py-3">
              Confirm &amp; enable
            </button>
          </form>
        </div>
      )}
      <section className="kb-card mt-6 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">Recent activity on this account</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Successful sign-ins and failed attempts alike. You are the person best placed to notice
          one you did not make &mdash; if anything here is not you, change your password and turn
          on two-factor.
        </p>

        {signIns.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--kb-text-dim)]">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
            {signIns.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span
                  className="text-sm"
                  style={{
                    color:
                      event.kind === "SIGNIN_OK"
                        ? "var(--kb-text)"
                        : "var(--kb-status-danger-ink)",
                  }}
                >
                  {event.label}
                </span>
                <span className="text-xs tabular-nums text-[var(--kb-text-dim)]">
                  {event.at.toLocaleString()}
                  {event.ip && ` · ${event.ip}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
