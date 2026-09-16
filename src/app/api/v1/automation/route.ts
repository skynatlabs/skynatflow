// What an automation platform needs to know, in one call.
//
// Zapier, Make and n8n each want the same thing: what can start an
// automation, what one can do, and how to authenticate. Served from one
// catalogue so the three can never drift apart — which is what happens when
// the same list is maintained in three vendor dashboards.

import { route } from "@/lib/api/handler";
import { catalogue } from "@/lib/api/automation";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller }) => ({
  workspace: caller.tenantId,
  ...catalogue(),
}));
