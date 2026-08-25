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

  return NextResponse.json({ prefill });
}
