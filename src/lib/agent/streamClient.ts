"use client";

// Reading the agent's NDJSON stream, in one place.
//
// Both command surfaces (the floating bar and the home console) need the same
// loop, and a second copy of a stream parser is a second place for a partial
// line to be mishandled — which shows up as a dropped final answer, rarely
// and only under load.

export interface AgentStreamProgress {
  type: "tool:start" | "tool:end" | "tool:held";
  tool: string;
  label: string;
  isMutation: boolean;
}

export interface AgentStreamDone {
  type: "done";
  ok: boolean;
  reply: string;
  mutated?: boolean;
  threadId?: string;
  runId?: string;
  pendingActions?: { tool: string; reason: string }[];
  reviewUrl?: string | null;
  error?: string;
}

export async function streamAgentCommand(params: {
  tenantId: string;
  text: string;
  threadId: string | null;
  path: string;
  onStart?: (threadId: string) => void;
  onProgress?: (event: AgentStreamProgress) => void;
  signal?: AbortSignal;
}): Promise<AgentStreamDone> {
  const { tenantId, text, threadId, path, onStart, onProgress, signal } = params;

  const res = await fetch(`/api/dashboard/${tenantId}/pa/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, threadId, path }),
    signal,
  });

  if (!res.ok || !res.body) {
    // A non-200 is JSON, not a stream — an auth or validation refusal.
    const detail = await res.json().catch(() => null);
    return {
      type: "done",
      ok: false,
      reply: detail?.error ?? "Couldn't reach flow just now.",
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: AgentStreamDone | null = null;

  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return; // never let one malformed line kill the run's answer
    }

    if (message.type === "start" && typeof message.threadId === "string") {
      onStart?.(message.threadId);
    } else if (typeof message.type === "string" && message.type.startsWith("tool:")) {
      onProgress?.(message as unknown as AgentStreamProgress);
    } else if (message.type === "done") {
      done = message as unknown as AgentStreamDone;
    }
  };

  for (;;) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on newlines and keep the remainder: a chunk boundary lands in the
    // middle of a JSON object often enough that not doing this loses answers.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  buffer += decoder.decode();
  consume(buffer);

  return (
    done ?? {
      type: "done",
      ok: false,
      reply: "The connection dropped before I finished. Check the agent console — the run is recorded there.",
    }
  );
}
