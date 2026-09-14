"use client";

import { useRouter } from "next/navigation";

export function ThemeToggle({
  current,
  // Admina puts the toggle in the navbar as one of its circular icon buttons,
  // not as a labelled row in the sidebar — same action, different shell.
  variant = "sidebar",
}: {
  current: "light" | "dark";
  variant?: "sidebar" | "admina";
}) {
  const router = useRouter();

  function toggle() {
    const next = current === "dark" ? "light" : "dark";
    document.cookie = `kb-theme=${next}; path=/; max-age=31536000`;
    router.refresh();
  }

  if (variant === "admina") {
    return (
      <button
        onClick={toggle}
        type="button"
        className="admina-nav-icon"
        aria-label={current === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {current === "dark" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.4 5.6l-1.4 1.4M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a6.8 6.8 0 0 0 9.5 9.5z" />
          </svg>
        )}
      </button>
    );
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
