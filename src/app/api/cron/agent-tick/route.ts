// The agent's heartbeat, hit on a schedule by vercel.json.
//
// Three jobs, in order: notice state the database implies but nobody emitted
// an event for (an invoice that quietly became overdue at midnight, stock that
// crossed its reorder point); let each workspace's agent react to everything
// queued; and run the named agents whose cron schedule has come due. Plus,
// periodically, an unprompted review of the business.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { sweepDerivedEvents } from "@/lib/agent/sweep";
import { tickAllTenants } from "@/lib/agent/tick";

export const dynamic = "force-dynamic";
// Agent runs are LLM calls; a workspace with a backlog needs room to finish.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = authorizeCron(req, "agent-tick");
  if (!auth.ok) return auth.response;

  const swept = await sweepDerivedEvents();
  const outcomes = await tickAllTenants();

  return NextResponse.json({
    ok: true,
    swept,
    tenants: outcomes.length,
    eventsHandled: outcomes.reduce((n, o) => n + o.eventsHandled, 0),
    reviewed: outcomes.filter((o) => o.reviewed).length,
    agentsRun: outcomes.reduce((n, o) => n + o.agentsRun, 0),
    raised: outcomes.reduce((n, o) => n + o.raised, 0),
    skipped: outcomes.filter((o) => o.skipped).length,
  });
}
