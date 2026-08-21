import { prisma } from "@/lib/db";

export async function listProposalTemplates(tenantId: string) {
  return prisma.proposalTemplate.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
}

export async function createProposalTemplate(params: {
  tenantId: string;
  name: string;
  introText?: string;
  scopeOfWork?: string;
}) {
  return prisma.proposalTemplate.create({ data: params });
}

export async function deleteProposalTemplate(id: string) {
  return prisma.proposalTemplate.delete({ where: { id } });
}
