// The polling trigger.
//
// Newest first, stable ids, `since` exclusive. Those are not style choices:
// the automation platforms de-duplicate on the id and stop at the first one
// they have seen, so a list that reorders between calls makes them replay old
// items or skip new ones — and the business finds out because a customer got
// the same message four times.
//
// `?sample=1` returns one made-up item so a platform can build its field
// mapping before the workspace has any real data. The alternative is asking
// somebody to invent a fake invoice to get past a setup screen.

import { route } from "@/lib/api/handler";
import { poll, sampleFor } from "@/lib/api/automation";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller, search, params }) => {
  const trigger = String(params.trigger ?? "");
  if (search.get("sample") === "1") return { items: [sampleFor(trigger)], sample: true };

  const since = search.get("since");
  const items = await poll({
    tenantId: caller.tenantId,
    trigger,
    since: since ? new Date(since) : undefined,
    limit: Number(search.get("limit") ?? 25),
  });
  return { items, count: items.length };
});
