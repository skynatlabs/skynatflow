import { prisma } from "@/lib/db";
const t = await prisma.tenant.findUnique({
  where: { id: "cmt0h6ysc0000iu8o0zl7yg8e" },
  select: { name: true, niche: true, memberships: { where: { role: "OWNER" }, select: { user: { select: { email: true } } } } },
});
console.log(JSON.stringify(t, null, 1));
await prisma.$disconnect();
