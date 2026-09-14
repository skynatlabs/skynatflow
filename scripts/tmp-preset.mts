import { prisma } from "@/lib/db";
import { applyPreset } from "@/lib/core/pdfTemplates";

const t = await prisma.tenantPdfTemplate.findFirst({
  where: { tenantId: "cmt0h6ysc0000iu8o0zl7yg8e" },
  select: { id: true, name: true },
});
if (!t) {
  console.log("NO_TEMPLATE");
} else {
  await applyPreset({
    tenantId: "cmt0h6ysc0000iu8o0zl7yg8e",
    templateId: t.id,
    presetKey: "statement",
  });
  console.log("APPLIED to " + t.name + " (" + t.id + ")");
}
await prisma.$disconnect();
