"use client";

// Polling refresh — no websocket infra in this stack, and this is
// consistent with how the rest of the dashboard already works (server
// components + revalidatePath). Good enough for internal team chat.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
