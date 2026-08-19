import Link from "next/link";
import { cookies } from "next/headers";
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
          <span
            className="grid h-9 w-9 place-items-center rounded-xl text-sm font-black text-white"
            style={{ background: "linear-gradient(135deg, var(--kb-accent-a), var(--kb-accent-b))" }}
          >
            O
          </span>
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
