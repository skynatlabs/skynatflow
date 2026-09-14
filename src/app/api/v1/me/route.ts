// "Does this key work, and what is it allowed to do?"
//
// The first call anyone integrating makes, and the one that makes every later
// 403 explicable rather than mysterious.

import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { CAPABILITIES_FOR } from "@/lib/api/describe";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller }) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: caller.tenantId },
    select: { id: true, name: true, niche: true },
  });

  return {
    key: { name: caller.name, role: caller.role, readOnly: caller.readOnly },
    workspace: tenant,
    can: CAPABILITIES_FOR(caller.role, caller.readOnly),
  };
});
