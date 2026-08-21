import Link from "next/link";
import { cookies } from "next/headers";
import { FlowMark } from "@/components/FlowMark";
import { loginAction } from "./actions";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const theme = cookieStore.get("kb-theme")?.value === "dark" ? "dark" : "light";

  return (
    <div className="kb-shell flex min-h-screen items-center justify-center p-8" data-theme={theme}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2">
          <FlowMark size={34} />
          <span className="kb-gradient-text text-2xl font-extrabold">Sign in</span>
        </div>

        <form action={loginAction} className="kb-card mt-6 space-y-4 p-6">
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">Email</label>
            <input name="email" type="email" required className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">Password</label>
            <input name="password" type="password" required className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">
              2FA code <span className="text-[var(--kb-text-dim)]">(only if you've enabled it)</span>
            </label>
            <input
              name="totpToken"
              inputMode="numeric"
              placeholder="123456"
              className={inputClass}
            />
          </div>
          <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--kb-text-dim)]">
          New here? <Link href="/signup" className="font-medium text-[var(--kb-accent-a)]">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
