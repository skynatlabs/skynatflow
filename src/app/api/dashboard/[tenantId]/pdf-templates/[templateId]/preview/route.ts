// The template editor's live preview.
//
// A builder without a preview is a form: you change a setting, save, and find
// out what it did the next time you send a customer a document. This renders
// the real component with real-shaped sample data, so what you see here is
// what the PDF engine will actually produce — not an HTML approximation of it
// that drifts from the renderer over time.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { renderTemplatePreview } from "@/lib/pdf/render";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; templateId: string }> }
) {
  const { tenantId, templateId } = await params;

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  await requireTenantAccess(tenantId);

  try {
    const buffer = await renderTemplatePreview({ tenantId, templateId });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="template-preview.pdf"',
        // The point of the preview is that it changes; a cached one would
        // show the previous save and read as the editor being broken.
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error(`[pdf:preview:${tenantId}/${templateId}]`, err);
    return NextResponse.json({ error: "Couldn't render a preview." }, { status: 500 });
  }
}
