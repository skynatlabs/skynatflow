import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { extractQuotePdf } from "@/lib/onboarding/extractQuotePdf";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — plenty for a text-based quote PDF, keeps memory bounded

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That PDF is too large (max 10MB)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const extraction = await extractQuotePdf(buffer);

  if (!extraction) {
    return NextResponse.json(
      { error: "Couldn't read that PDF — you can still fill this in manually." },
      { status: 200 }
    );
  }

  return NextResponse.json({ extraction });
}
