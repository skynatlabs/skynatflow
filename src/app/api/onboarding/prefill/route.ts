import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prefillFromUrl } from "@/lib/onboarding/prefill";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { url } = await req.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const prefill = await prefillFromUrl(url);
  if (!prefill) {
    return NextResponse.json(
      { error: "Couldn't read that site — you can still fill this in manually." },
      { status: 200 }
    );
  }

  // Fetched server-side and inlined as a data URL — the browser can't load
  // an arbitrary third-party image into a form field without hitting CORS,
  // and this is the one shot at grabbing it while we already have the URL.
  let logoDataUrl: string | null = null;
  if (prefill.logoUrl) {
    try {
      const imgRes = await fetch(prefill.logoUrl, { signal: AbortSignal.timeout(5000) });
      const contentType = imgRes.headers.get("content-type") ?? "";
      if (imgRes.ok && contentType.startsWith("image/")) {
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        if (buffer.length < 2 * 1024 * 1024) {
          logoDataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
        }
      }
    } catch {
      // Logo fetch failing is never worth blocking the rest of prefill on.
    }
  }

  return NextResponse.json({ prefill: { ...prefill, logoDataUrl } });
}
