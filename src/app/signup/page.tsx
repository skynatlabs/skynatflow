import Link from "next/link";
import { cookies } from "next/headers";
import { FlowMark } from "@/components/FlowMark";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { googleLoginEnabled } from "@/auth";
import { signupAction } from "./actions";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export default async function SignupPage() {
  const cookieStore = await cookies();
  const theme = cookieStore.get("kb-theme")?.value === "dark" ? "dark" : "light";

  return (
    <div className="kb-shell flex min-h-screen items-center justify-center p-8" data-theme={theme}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2">
          <FlowMark size={34} />
          <span className="kb-gradient-text text-2xl font-extrabold">Create your account</span>
        </div>

        <div className="mt-6 space-y-3">
          {googleLoginEnabled && (
            <>
              <GoogleSignInButton label="Sign up with Google" />
              <div className="flex items-center gap-3 text-xs text-[var(--kb-text-dim)]">
                <span className="h-px flex-1 bg-[var(--kb-panel-border)]" />
                or
                <span className="h-px flex-1 bg-[var(--kb-panel-border)]" />
              </div>
            </>
          )}
        </div>

        <form action={signupAction} className="kb-card mt-3 space-y-4 p-6">
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">Name</label>
            <input name="name" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">Email</label>
            <input name="email" type="email" required className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">
              Password <span className="text-[var(--kb-text-dim)]">(8+ characters)</span>
            </label>
            <input name="password" type="password" minLength={8} required className={inputClass} />
          </div>
          <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
            Create account
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--kb-text-dim)]">
          Already have an account? <Link href="/login" className="font-medium text-[var(--kb-accent-a)]">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
