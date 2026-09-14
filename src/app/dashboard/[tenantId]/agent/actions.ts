"use server";

import { revalidatePath } from "next/cache";
import type { AgentAutonomy } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { prisma } from "@/lib/db";
import { approveRun, rejectRun, approveAction, rejectAction } from "@/lib/agent/approvals";
import { createAgent, deleteAgent, runNamedAgent, setAgentActive } from "@/lib/agent/named";
import { forgetFact } from "@/lib/agent/memory";
import { isValidCron } from "@/lib/agent/schedule";

export async function approveRunAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  // Approving executes real actions, so it needs a real capability — not
  // merely being signed in to the workspace.
  assertCan(access.role, "task:manage");

  await approveRun({
    tenantId,
    runId: String(formData.get("runId") ?? ""),
    approver: {
      userId: access.userId,
      role: access.role,
      membershipId: access.membershipId,
    },
  });
  revalidatePath(`/dashboard/${tenantId}/agent`);
  revalidatePath(`/dashboard/${tenantId}`);
}

export async function rejectRunAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  await rejectRun({
    tenantId,
    runId: String(formData.get("runId") ?? ""),
    userId: access.userId,
  });
  revalidatePath(`/dashboard/${tenantId}/agent`);
  revalidatePath(`/dashboard/${tenantId}`);
}

/**
 * Approves one held action, leaving the rest of the run waiting.
 *
 * Same capability check as approving the whole run — this is a narrower
 * choice, not a lesser one.
 */
export async function approveActionAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  const index = Number(formData.get("index"));
  if (!Number.isInteger(index) || index < 0) throw new Error("Unknown action.");

  await approveAction({
    tenantId,
    runId: String(formData.get("runId") ?? ""),
    index,
    approver: {
      userId: access.userId,
      role: access.role,
      membershipId: access.membershipId,
    },
  });
  revalidatePath(`/dashboard/${tenantId}/agent`);
  revalidatePath(`/dashboard/${tenantId}`);
}

export async function rejectActionAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  const index = Number(formData.get("index"));
  if (!Number.isInteger(index) || index < 0) throw new Error("Unknown action.");

  await rejectAction({
    tenantId,
    runId: String(formData.get("runId") ?? ""),
    index,
    userId: access.userId,
  });
  revalidatePath(`/dashboard/${tenantId}/agent`);
  revalidatePath(`/dashboard/${tenantId}`);
}

export async function setAutonomyAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  // How much the business lets software act alone is an owner's decision.
  assertCan(access.role, "staff:manage");

  const autonomy = String(formData.get("autonomy") ?? "") as AgentAutonomy;
  if (!["SUGGEST_ONLY", "REVERSIBLE", "FULL"].includes(autonomy)) {
    throw new Error("Unknown autonomy level.");
  }
  const proactive = formData.get("proactive") === "on";

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { agentAutonomy: autonomy, agentProactiveEnabled: proactive },
  });
  revalidatePath(`/dashboard/${tenantId}/agent`);
}

export async function createAgentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const name = String(formData.get("name") ?? "").trim();
  const brief = String(formData.get("brief") ?? "").trim();
  if (!name || !brief) throw new Error("Give the agent a name and say what it's for.");

  const toolNames = formData
    .getAll("toolNames")
    .map((t) => String(t))
    .filter(Boolean);
  const schedule = String(formData.get("schedule") ?? "").trim() || null;
  // A schedule the matcher can't read would store fine and then silently
  // never fire, which is exactly the failure this whole pass exists to fix.
  if (schedule && !isValidCron(schedule)) {
    throw new Error("That schedule isn't one I can read — pick one from the list.");
  }

  await createAgent({ tenantId, name, brief, toolNames, schedule });
  revalidatePath(`/dashboard/${tenantId}/agent`);
}

export async function toggleAgentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await setAgentActive(
    tenantId,
    String(formData.get("agentId") ?? ""),
    formData.get("isActive") === "true"
  );
  revalidatePath(`/dashboard/${tenantId}/agent`);
}

export async function deleteAgentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await deleteAgent(tenantId, String(formData.get("agentId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/agent`);
}

export async function runAgentNowAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  await runNamedAgent({
    tenantId,
    agentId: String(formData.get("agentId") ?? ""),
    // A person clicked this and is watching, which is what lets the gate
    // allow irreversible actions it would otherwise hold.
    userPresent: true,
    actor: { userId: access.userId, membershipId: access.membershipId },
  });
  revalidatePath(`/dashboard/${tenantId}/agent`);
}

export async function forgetFactAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await forgetFact(tenantId, String(formData.get("key") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/agent`);
}
