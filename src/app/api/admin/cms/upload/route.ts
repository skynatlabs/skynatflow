// Image upload endpoint for the marketing CMS editor. Super-admin only.

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, AuthRequiredError, ForbiddenError } from "@/lib/auth/tenant-access";
import { uploadCmsImage } from "@/lib/storage/r2";

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ error: "Sign-in required" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  try {
    const url = await uploadCmsImage(file);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 }
    );
  }
}
