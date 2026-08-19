"use client";

import { useRouter } from "next/navigation";

export function ThemeToggle({ current }: { current: "light" | "dark" }) {
  const router = useRouter();

  function toggle() {
    const next = current === "dark" ? "light" : "dark";
    document.cookie = `kb-theme=${next}; path=/; max-age=31536000`;
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      className="flex w-full items-center justify-between rounded-full bg-white/[0.06] px-4 py-2.5 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
    >
      <span>{current === "dark" ? "Dark mode" : "Light mode"}</span>
      <span>{current === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
