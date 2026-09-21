// The agent loop.
//
// This replaced the single-shot intent classifier the PA used to be: one
// generateObject call whose `intent` was an enum of three values, branched on
// in code, so anything nobody enumerated in advance came back "I didn't
// understand" even when the functions to answer it already existed.
//
// The model now gets the Business Graph as tools and a step budget, and
// composes. Safety comes from four places, none of which is the prompt:
//
//   - the tool set is built per-caller, so a role never sees a tool it
//     couldn't run                                    (agent/tools.ts)
//   - tenant id is closed over, never a model argument (agent/tools.ts)
//   - irreversible tools are intercepted before they execute when nobody is
//     watching                                         (agent/autonomy.ts)
//   - every run is recorded with its steps, so an action taken unattended is
//     always attributable and inspectable              (AgentRun)

import { generateText, stepCountIs, type ToolSet } from "ai";
import type { AgentAutonomy, AgentRunTrigger } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aiModelChain, getAgentTier, worthFailingOver } from "@/lib/ai/model";
import { mayRun, recordSpend } from "@/lib/agent/budget";
import { preferenceNotes } from "@/lib/agent/learning";
import { buildAgentTools, MUTATING_TOOLS, type AgentContext } from "@/lib/agent/tools";
import { canAutoRun } from "@/lib/agent/autonomy";
import { loadFacts, loadThread, appendToThread, type ThreadTurn } from "@/lib/agent/memory";
import { pageContextPrompt, type PageContext } from "@/lib/agent/pageContext";
import { toolLabelProgressive } from "@/lib/agent/toolLabels";
import { selectTools } from "@/lib/agent/toolSelection";

export interface AgentStep {
  tool: string;
  input: unknown;
  output: unknown;
  isMutation: boolean;
  /** Set when the gate stopped this call instead of running it. */
  blockedReason?: string;
}

/**
 * What the agent is doing, as it does it.
 *
 * Emitted from the tool wrapper rather than from an SDK callback: this code
 * already intercepts every call for the autonomy gate, so instrumenting it
 * here cannot miss one and doesn't move when the SDK's callback names do.
 */
export interface AgentProgress {
  type: "tool:start" | "tool:end" | "tool:held";
  tool: string;
  /** Phrased as work: "Looking for stale documents". */
  label: string;
  isMutation: boolean;
}

export interface AgentResult {
  ok: boolean;
  reply: string;
  steps: AgentStep[];
  mutated: boolean;
  runId: string;
  threadId?: string;
  /** Tool calls the gate held back — the approval queue for this run. */
  pendingActions: { tool: string; input: unknown; reason: string }[];
  error?: string;
}

// Hard ceiling on tool calls per run. High enough for a genuine multi-step
// task (resolve a customer, read their history, build a quote), low enough
// that a confused model can't spend the tenant's whole AI budget in one go.
const MAX_STEPS = 12;

/**
 * The instructions, and nothing that changes between requests.
 *
 * This is deliberately stable: it is the front of the prompt, it sits behind
 * the same cache breakpoint as the tool schemas, and a provider will only
 * charge us a tenth of the price for it if it is byte-identical to last time.
 * It used to carry the current timestamp and whatever page the person was
 * looking at, which meant the prefix changed on every single call and nothing
 * could ever be cached. Those two now travel with the request instead — see
 * requestPreamble — which costs a few tokens a turn and saves thousands.
 */
function systemPrompt(params: {
  ctx: AgentContext;
  facts: string[];
  autonomy: AgentAutonomy;
  userPresent: boolean;
  brief?: string;
}): string {
  const { ctx, facts, userPresent, brief } = params;

  const lines = [
    `You are the AI assistant inside flow, a business management platform.`,
    `You are working inside one workspace. Everything you can see and touch`,
    `already belongs to it — you never need to ask for or supply a workspace,`,
    `tenant, or account id, and there is no way to reach another company's data.`,
    ``,
    `In this workspace a customer is called a "${ctx.customerLabel}".`,
    `Each message tells you the current date and time. Resolve relative dates`,
    `("Tuesday morning", "end of the month") against that, never against your`,
    `own sense of when now is.`,
    `Money is always in cents in tool inputs and outputs. R1,250.00 is 125000.`,
  ];

  if (brief) {
    lines.push(``, `Your specific job in this workspace:`, brief);
  }

  if (facts.length > 0) {
    lines.push(
      ``,
      `What you already know about this business (learned from earlier work —`,
      `treat as context, and correct it if what you find now disagrees):`,
      ...facts.map((f) => `- ${f}`)
    );
  }

  lines.push(
    ``,
    `How to work:`,
    `- Look things up before acting. Resolve a name to an id with findCustomers`,
    `  or listProducts rather than guessing an id.`,
    `- If a request is ambiguous in a way that matters — two customers with the`,
    `  same name, an amount you had to infer — ask one short question instead of`,
    `  picking for them.`,
    `- Quotes you create are DRAFTS. Do not send anything to a customer unless`,
    `  the user clearly asked for it to go out.`,
    `- If you lack a tool for what was asked, say so plainly and say what you`,
    `  did instead. Never claim to have done something you did not do.`,
    `- When you learn something durable that no future query could tell you —`,
    `  how someone prefers to be dealt with, why a supplier is slow, a standing`,
    `  arrangement, a correction the user made — write it down with`,
    `  rememberFact. Don't store anything you could simply look up again.`
  );

  if (!userPresent) {
    lines.push(
      ``,
      `Nobody is watching this run — it was started by a schedule or by`,
      `something happening in the business, not by a person asking. Anything`,
      `that moves money or contacts a customer will be held for approval`,
      `rather than executed, so propose it and explain why; don't assume it`,
      `happened. Be selective: only raise things genuinely worth an`,
      `interruption.`
    );
  }

  lines.push(
    ``,
    `Answer like a capable colleague: short, concrete, no preamble. State what`,
    `you did and the numbers that matter. Do not describe your tool calls.`
  );

  return lines.join("\n");
}

/**
 * What is true only of this request: the clock, and what they are looking at.
 *
 * Lives on the user message rather than in the system prompt so that the
 * system prompt can be cached. Reads a little oddly in isolation and reads
 * perfectly well to a model, which is the only reader it has.
 */
function requestPreamble(now: Date, page: PageContext | null): string {
  const lines = [`[The current date and time is ${now.toISOString()}.]`];
  const pageLines = pageContextPrompt(page);
  if (pageLines.length > 0) lines.push(...pageLines);
  return `${lines.join("\n")}\n\n`;
}

export async function runAgent(params: {
  ctx: AgentContext;
  input: string;
  trigger?: AgentRunTrigger;
  /** False for scheduled/event runs — tightens the autonomy gate. */
  userPresent?: boolean;
  threadId?: string | null;
  /** Named-agent config, when this run belongs to one. */
  agentId?: string | null;
  brief?: string;
  /** Named agents may be narrowed to a subset. Empty/undefined = everything. */
  allowedTools?: string[];
  /** What the person is looking at, for resolving "this one". */
  page?: PageContext | null;
  /** Called as each tool starts and finishes, for the live view. */
  onProgress?: (event: AgentProgress) => void;
  now?: Date;
  /** Gives up on the model when this fires — a scheduled run's time limit. */
  abortSignal?: AbortSignal;
}): Promise<AgentResult> {
  const {
    ctx,
    input,
    trigger = "USER",
    userPresent = trigger === "USER",
    threadId = null,
    agentId = null,
    brief,
    allowedTools,
    page = null,
    onProgress,
    now = new Date(),
    abortSignal,
  } = params;

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    select: { agentAutonomy: true },
  });
  const autonomy = tenant.agentAutonomy;

  const run = await prisma.agentRun.create({
    data: {
      tenantId: ctx.tenantId,
      threadId,
      agentId,
      trigger,
      actorUserId: userPresent ? ctx.userId : null,
      input,
      status: "RUNNING",
    },
    select: { id: true },
  });

  const fail = async (reply: string, error: string): Promise<AgentResult> => {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "FAILED", reply, error, finishedAt: new Date() },
    });
    return {
      ok: false,
      reply,
      steps: [],
      mutated: false,
      runId: run.id,
      threadId: threadId ?? undefined,
      pendingActions: [],
      error,
    };
  };

  // The agent thinks on whichever tier this workspace is set to — fast by
  // default, because a run is only ever offered the handful of tools its
  // request could need, and choosing among those is not work that requires a
  // frontier model.
  const chain = await aiModelChain({ tenantId: ctx.tenantId, tier: await getAgentTier(ctx.tenantId) });
  if (chain.length === 0) {
    return fail(
      "No AI provider is configured for this platform yet — an admin can set one up in the admin console.",
      "no_model"
    );
  }

  // A workspace's monthly budget stops the background work and never stops a
  // person who is sitting there asking. Being told the agent is out of budget
  // mid-question is a worse outcome than a few cents.
  const budget = await mayRun({ tenantId: ctx.tenantId, userPresent, now });
  if (!budget.allowed) return fail(budget.reason, "over_budget");

  const [facts, history, preferences] = await Promise.all([
    loadFacts(ctx.tenantId),
    threadId ? loadThread(threadId, ctx.tenantId) : Promise.resolve([] as ThreadTurn[]),
    // What this workspace has consistently accepted and refused. Phrased as
    // taste rather than prohibition — see agent/learning.ts.
    preferenceNotes(ctx.tenantId, now).catch(() => [] as string[]),
  ]);

  // The gate wraps each mutating tool's execute. Interception happens here,
  // in code, rather than being requested of the model — a model that decides
  // to send anyway still doesn't get to.
  const pendingActions: { tool: string; input: unknown; reason: string }[] = [];
  const all = buildAgentTools(ctx);
  // A named agent can be narrowed to the tools its job needs. Read tools stay
  // available regardless — restricting what an agent may *look at* only makes
  // it guess, and guessing is worse than knowing.
  const permitted: ToolSet =
    allowedTools && allowedTools.length > 0
      ? Object.fromEntries(
          Object.entries(all).filter(
            ([name]) => allowedTools.includes(name) || !MUTATING_TOOLS.has(name)
          )
        )
      : all;

  // Then narrowed again, to the ones this REQUEST could plausibly need.
  //
  // The full set is 38,866 tokens of schema — measured — and was being sent,
  // in full, on every turn of every run. Selecting against the request cuts
  // that by about seven eighths for a typical question. The risk this trades
  // against is withholding a tool the model needed, which is why selection is
  // lexical, deterministic, and held to a recall corpus that runs on every
  // build (tests/agent/tool-selection.test.ts).
  //
  // A named agent's declared tools are passed as hints, not left to scoring:
  // an agent told to do a specific job should always be able to reach for the
  // tools of that job, however its instruction happens to be worded.
  const selection = selectTools(permitted, {
    text: [input, brief ?? "", page?.description ?? "", page?.listing ?? ""].filter(Boolean).join("\n"),
    hints: allowedTools ?? [],
  });
  const rawTools = selection.tools;
  const tools: ToolSet = {};

  for (const [name, def] of Object.entries(rawTools)) {
    const isMutation = MUTATING_TOOLS.has(name);
    const label = toolLabelProgressive(name);
    const original = def as { execute?: (input: unknown, opts: unknown) => Promise<unknown> };

    // A tool with no execute is one the SDK runs some other way; wrapping it
    // would replace a working definition with a call to undefined.
    const run = original.execute;
    if (!run) {
      tools[name] = def;
      continue;
    }

    tools[name] = {
      ...def,
      execute: async (toolInput: unknown, opts: unknown) => {
        onProgress?.({ type: "tool:start", tool: name, label, isMutation });

        if (isMutation) {
          const verdict = canAutoRun({ toolName: name, autonomy, userPresent, isMutation });
          if (!verdict.allowed) {
            pendingActions.push({ tool: name, input: toolInput, reason: verdict.reason });
            onProgress?.({ type: "tool:held", tool: name, label, isMutation });
            // Returned to the model, not thrown: it should carry on reasoning
            // and report honestly that this part is waiting, rather than
            // treating it as a failure and retrying.
            return {
              held: true,
              reason: verdict.reason,
              note: "This action was NOT performed. It is queued for a person to approve.",
            };
          }
        }

        try {
          return await run(toolInput, opts);
        } finally {
          // finally, not after: a tool that throws still stopped running, and
          // a progress list stuck on "Recording a payment…" reads as though
          // it is still going.
          onProgress?.({ type: "tool:end", tool: name, label, isMutation });
        }
      },
    } as ToolSet[string];
  }

  try {
    const system =
      systemPrompt({ ctx, facts, autonomy, userPresent, brief }) +
      (preferences.length > 0 ? `\n\nWhat this business has told you by what it accepts:\n- ${preferences.join("\n- ")}` : "");

    // Providers in order, best first. An outage at one vendor should be a
    // slower answer rather than no answer — but only for the failures where
    // the same request might work elsewhere. A refusal or a malformed request
    // is retried nowhere: it would fail again, more slowly and at twice the
    // cost. See ai/model.ts.
    let result: Awaited<ReturnType<typeof generateText>> | null = null;
    let lastError: unknown = null;
    let servedBy = chain[0];

    for (const candidate of chain) {
      try {
        servedBy = candidate;
        result = await generateText({
          model: candidate.model,
          system,
          messages: [...history, { role: "user" as const, content: requestPreamble(now, page) + input }],
          tools,
          // Pay full price for the static prefix once, not on every step.
          //
          // The system prompt and the tool schemas are identical across every
          // step of a run and across every turn in a workspace, and they are
          // the bulk of what we send. Anthropic bills a cached read at a
          // fraction of the input price; OpenAI caches automatically and uses
          // the key to route a request back to the same warm cache; Gemini
          // does it implicitly and needs nothing from us.
          //
          // The cache key is per workspace because the prefix is: it carries
          // that workspace's own facts and preferences. Sharing a key across
          // tenants would be both useless and wrong.
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
            openai: { promptCacheKey: `flow:${ctx.tenantId}`, promptCacheRetention: "24h" },
          },
          // The loop. Without this the SDK returns after a single tool call and
          // the model never sees what the call returned — exactly the limitation
          // the old classifier had.
          stopWhen: stepCountIs(MAX_STEPS),
          abortSignal,
        });
        break;
      } catch (err) {
        lastError = err;
        if (!worthFailingOver(err) || candidate === chain[chain.length - 1]) throw err;
        console.warn(`[agent] ${candidate.provider} failed, trying the next provider:`, err);
      }
    }
    if (!result) throw lastError ?? new Error("No provider answered.");

    // What it cost, recorded per run so a budget can be enforced before the
    // next one rather than discovered on an invoice.
    await recordSpend({
      tenantId: ctx.tenantId,
      runId: run.id,
      agentId: agentId ?? null,
      provider: servedBy.provider,
      model: servedBy.modelId,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      // Zero here on a warm workspace means the cache is not being hit, which
      // means something volatile has crept back into the static prefix.
      cachedInputTokens: result.usage?.inputTokenDetails?.cacheReadTokens ?? 0,
      at: new Date(),
    }).catch((err) => console.error("[agent] could not record what the run cost:", err));

    const steps: AgentStep[] = [];
    for (const step of result.steps) {
      for (const call of step.toolCalls ?? []) {
        const match = (step.toolResults ?? []).find(
          (r) => "toolCallId" in r && r.toolCallId === call.toolCallId
        );
        const output = match && "output" in match ? match.output : undefined;
        const held =
          typeof output === "object" && output !== null && (output as { held?: boolean }).held === true;
        steps.push({
          tool: call.toolName,
          input: "input" in call ? call.input : undefined,
          output,
          isMutation: MUTATING_TOOLS.has(call.toolName),
          blockedReason: held ? (output as { reason?: string }).reason : undefined,
        });
      }
    }

    const mutated = steps.some((s) => s.isMutation && !s.blockedReason);
    const reply = result.text.trim() || describeSteps(steps);
    const status = pendingActions.length > 0 ? "AWAITING_APPROVAL" : "DONE";

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status,
        reply,
        steps: JSON.parse(JSON.stringify(steps)),
        pendingActions: pendingActions.length
          ? JSON.parse(JSON.stringify(pendingActions))
          : undefined,
        finishedAt: new Date(),
      },
    });

    if (threadId) {
      await appendToThread(threadId, [
        { role: "user", content: input },
        { role: "assistant", content: reply },
      ]);
    }

    return {
      ok: true,
      reply,
      steps,
      mutated,
      runId: run.id,
      threadId: threadId ?? undefined,
      pendingActions,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[agent:${ctx.tenantId}] run ${run.id} failed:`, err);
    // A provider-side billing or key problem is the most common cause, and it
    // is fixable by whoever reads the message — but only if they're told which
    // it is. A generic "something went wrong" sends an admin hunting a bug
    // that isn't in the code.
    return fail(explainFailure(message), message);
  }
}

function explainFailure(message: string): string {
  const m = message.toLowerCase();

  if (
    m.includes("credits are depleted") ||
    m.includes("quota") ||
    m.includes("resource_exhausted") ||
    m.includes("insufficient_quota") ||
    m.includes("billing")
  ) {
    return (
      "I can't run right now — the AI provider account is out of credit. " +
      "An admin needs to top it up, or switch provider in the admin console. " +
      "Everything else in flow keeps working."
    );
  }

  if (
    m.includes("api key") ||
    m.includes("unauthenticated") ||
    m.includes("permission_denied") ||
    m.includes("401") ||
    m.includes("invalid_api_key")
  ) {
    return (
      "I can't run right now — the AI provider key looks invalid or expired. " +
      "An admin can update it in the admin console."
    );
  }

  if (m.includes("rate limit") || m.includes("429")) {
    return "The AI provider is rate-limiting us at the moment — try that again in a minute.";
  }

  return (
    "Something went wrong while I was working on that. Nothing was left half-done — " +
    "try again, or do it from the dashboard."
  );
}

function describeSteps(steps: AgentStep[]): string {
  if (steps.length === 0) return "I couldn't work out what to do with that — can you rephrase it?";
  const done = steps.filter((s) => s.isMutation && !s.blockedReason).map((s) => s.tool);
  const held = steps.filter((s) => s.blockedReason).map((s) => s.tool);
  const parts: string[] = [];
  if (done.length) parts.push(`Done: ${done.join(", ")}.`);
  if (held.length) parts.push(`Waiting for your approval: ${held.join(", ")}.`);
  if (parts.length === 0) return "I looked into that but didn't find anything to report.";
  return parts.join(" ");
}
