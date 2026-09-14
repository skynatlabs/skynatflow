"use client";

// The agent, on every page.
//
// This replaces FloatingPaButton, which was reachable everywhere but was
// still shaped like the old one-shot PA: it showed a single reply, forgot it
// on the next question, and — the real bug — said nothing at all when the
// autonomy gate held an action back. The agent would answer "I've queued a
// payment for approval", the user would read a sentence about it, and there
// was no link anywhere to go and approve it.
//
// Four things make this the command surface rather than a chat box:
//
//   - it is docked to the bottom of every page, always visible and always
//     ready — a composer, not a popup you have to go and open. A round
//     button in the corner asks you to remember it exists; a bar you can
//     already type into does not.
//   - it knows what page you're on, so "chase this one" resolves (the path
//     goes to the server, which derives the record — see agent/pageContext)
//   - held actions surface as a queue with a way to act on them
//   - Cmd/Ctrl-K, because an assistant you have to aim a mouse at is a
//     feature, and one that's a keystroke away is how you work

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { speak } from "@/lib/voice/speakClient";
import { streamAgentCommand, type AgentStreamProgress } from "@/lib/agent/streamClient";
import { toolLabel } from "@/lib/agent/toolLabels";

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEvent {
  results: { [index: number]: SpeechRecognitionResult; length: number };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

/** One tool call, as the person watching it sees it. */
interface Activity {
  label: string;
  state: "running" | "done" | "held";
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  pending?: { tool: string; reason: string }[];
  reviewUrl?: string | null;
  failed?: boolean;
  /** What it did to get there — kept after the run so it stays inspectable. */
  activity?: Activity[];
}

/**
 * What to offer before they've typed anything.
 *
 * Generic prompts ("ask me anything") teach nobody what the thing can do.
 * These change with the page, so the first suggestion a person sees on an
 * invoice is one that only makes sense on an invoice.
 */
function suggestionsFor(path: string, tenantId: string): string[] {
  const rest = path.replace(`/dashboard/${tenantId}`, "").replace(/^\/+/, "");
  const section = rest.split("/")[0] ?? "";
  const isDetail = rest.split("/").length > 1 && !["new", "import"].includes(rest.split("/")[1]);

  if (section === "invoices" && isDetail) {
    return ["Chase this invoice", "Has this customer paid late before?", "Draft a payment reminder"];
  }
  if (section === "quotes" && isDetail) {
    return ["Follow up on this quote", "Turn this into an invoice", "What did they buy last time?"];
  }
  if (section === "customers" && isDetail) {
    return ["What do they owe us?", "Summarise our history with them", "Draft a quote for them"];
  }
  if (section === "overdue") return ["Who should I chase first?", "Draft chasers for the worst three"];
  if (section === "quotes") return ["Which quotes have gone quiet?", "Which are customers still opening?"];
  if (section === "inventory" || section === "products") {
    return ["What's about to run out?", "What should I reorder this week?"];
  }
  if (section === "tasks") return ["What's overdue?", "Add a task to call the supplier"];
  return ["How is the business doing?", "Who owes us the most?", "What's gone quiet this week?"];
}

export function CommandBar({
  tenantId,
  awaitingApproval = 0,
}: {
  tenantId: string;
  /** Held actions across the workspace, so the badge is right on every page. */
  awaitingApproval?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  // The server owns the transcript; the client only carries the id.
  const [threadId, setThreadId] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    // Capability detection has to run after mount — `window` doesn't exist
    // during the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMicSupported(
      typeof window !== "undefined" &&
        !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    );
  }, []);

  // Cmd/Ctrl-K puts the cursor in the bar. It no longer toggles anything:
  // the bar is always on screen, so there is nothing to summon — only
  // somewhere to jump to. Escape closes the transcript and leaves the bar.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const send = useCallback(
    async (instruction: string) => {
      const value = instruction.trim();
      if (!value || busy) return;

      setTurns((t) => [...t, { role: "user", content: value }]);
      setText("");
      setBusy(true);
      setActivity([]);
      // A suggestion chip can be clicked while the transcript is closed;
      // whatever the route in, the answer has to have somewhere to land.
      setOpen(true);

      // Held locally as well as in state: the stream's callbacks fire faster
      // than React commits, and marking a step finished has to find the step
      // that started, not a stale copy of the list.
      const live: Activity[] = [];

      const onProgress = (event: AgentStreamProgress) => {
        if (event.type === "tool:start") {
          live.push({ label: event.label, state: "running" });
        } else {
          // Match the most recent running entry for this label — the same
          // tool can legitimately run twice in one turn.
          for (let i = live.length - 1; i >= 0; i--) {
            if (live[i].label === event.label && live[i].state === "running") {
              live[i] = {
                label: event.label,
                state: event.type === "tool:held" ? "held" : "done",
              };
              break;
            }
          }
        }
        setActivity([...live]);
      };

      try {
        const result = await streamAgentCommand({
          tenantId,
          text: value,
          threadId,
          // `path` is what lets "this one" mean anything. The server decides
          // what it refers to; the client just reports where it is.
          path: pathname,
          onStart: (id) => setThreadId(id),
          onProgress,
        });

        const answer = result.reply || result.error || "I couldn't work that out.";
        if (result.threadId) setThreadId(result.threadId);
        setTurns((t) => [
          ...t,
          {
            role: "assistant",
            content: answer,
            pending: result.pendingActions?.length ? result.pendingActions : undefined,
            reviewUrl: result.reviewUrl ?? null,
            failed: result.ok === false,
            activity: live.length ? [...live] : undefined,
          },
        ]);
        speak(tenantId, answer);

        // Refresh the page behind the panel so its numbers agree with what
        // the agent just said it did — but never navigate away mid-thread.
        if (result.mutated) router.refresh();
      } catch {
        setTurns((t) => [
          ...t,
          { role: "assistant", content: "Couldn't reach flow just now.", failed: true },
        ]);
      } finally {
        setActivity([]);
        setBusy(false);
      }
    },
    [busy, pathname, router, tenantId, threadId]
  );

  function startListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setText(transcript);
        send(transcript);
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  const started = turns.length > 0;
  const suggestions = suggestionsFor(pathname, tenantId);

  return (
    <div className="kb-dock">
      <div className="kb-dock-inner">
        {open && (
          <section className="kb-dock-panel" aria-label="Conversation with flow">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--kb-panel-border)] px-4 py-2.5">
              <p className="text-xs font-semibold text-[var(--kb-text)]">
                flow
                <span className="ml-2 font-normal text-[var(--kb-text-dim)]">
                  can see the page you&apos;re on
                </span>
              </p>
              <div className="flex shrink-0 items-center gap-3">
                {started && (
                  <button
                    type="button"
                    onClick={() => {
                      setTurns([]);
                      setThreadId(null);
                    }}
                    className="text-[11px] text-[var(--kb-text-dim)] hover:underline"
                  >
                    New chat
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close conversation"
                  className="text-lg leading-none text-[var(--kb-text-dim)] hover:text-[var(--kb-text)]"
                >
                  ×
                </button>
              </div>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {!started ? (
                <>
                  {awaitingApproval > 0 && (
                    <a
                      href={`/dashboard/${tenantId}/agent`}
                      className="mb-3 block rounded-lg px-3 py-2 text-xs font-medium"
                      style={{
                        background: "var(--kb-tint-yellow)",
                        color: "var(--kb-tint-yellow-ink)",
                      }}
                    >
                      {awaitingApproval === 1
                        ? "1 action is waiting for your approval"
                        : `${awaitingApproval} actions are waiting for your approval`}{" "}
                      — review →
                    </a>
                  )}
                  <p className="text-xs text-[var(--kb-text-dim)]">Try one of these:</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="kb-pill kb-pill-ghost text-left text-[11px]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <ol className="space-y-2.5">
                  {turns.map((turn, i) => (
                    <li
                      key={i}
                      className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
                    >
                      <div
                        className="max-w-[88%] rounded-2xl px-3 py-2 text-[13px]"
                        style={
                          turn.role === "user"
                            ? { background: "var(--kb-accent-a)", color: "#fff" }
                            : {
                                background: turn.failed
                                  ? "var(--kb-status-danger)"
                                  : "var(--kb-bg)",
                                color: turn.failed
                                  ? "var(--kb-status-danger-ink)"
                                  : "var(--kb-text)",
                              }
                        }
                      >
                        <p className="whitespace-pre-wrap break-words">{turn.content}</p>

                        {turn.pending && turn.pending.length > 0 && (
                          <div className="mt-2 rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] p-2">
                            <p className="text-[11px] font-medium text-[var(--kb-text)]">
                              {turn.pending.length === 1
                                ? "1 action needs your approval"
                                : `${turn.pending.length} actions need your approval`}
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {turn.pending.map((p, n) => (
                                <li key={n} className="text-[11px] text-[var(--kb-text-dim)]">
                                  {toolLabel(p.tool)}
                                </li>
                              ))}
                            </ul>
                            <a
                              href={`/dashboard/${tenantId}/agent`}
                              className="mt-1 inline-block text-[11px] font-medium underline"
                              style={{ color: "var(--kb-accent-a)" }}
                            >
                              Review and approve
                            </a>
                          </div>
                        )}

                        {turn.role === "assistant" && turn.activity && turn.activity.length > 0 && (
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-[11px] text-[var(--kb-text-dim)]">
                              What it did ({turn.activity.length})
                            </summary>
                            <div className="mt-1">
                              <ActivityList items={turn.activity} />
                            </div>
                          </details>
                        )}

                        {turn.reviewUrl && (
                          <a
                            href={turn.reviewUrl}
                            className="mt-1.5 inline-block text-[11px] underline"
                            style={{ color: turn.role === "user" ? "#fff" : "var(--kb-accent-a)" }}
                          >
                            Open it
                          </a>
                        )}
                      </div>
                    </li>
                  ))}

                  {busy && (
                    <li className="flex justify-start">
                      <div className="max-w-[88%] rounded-2xl bg-[var(--kb-bg)] px-3 py-2">
                        {activity.length === 0 ? (
                          <span className="flex gap-1" aria-label="Thinking">
                            {[0, 1, 2].map((d) => (
                              <span
                                key={d}
                                className="h-1.5 w-1.5 animate-bounce rounded-full motion-reduce:animate-none"
                                style={{
                                  background: "var(--kb-text-dim)",
                                  animationDelay: `${d * 0.15}s`,
                                }}
                              />
                            ))}
                          </span>
                        ) : (
                          <ActivityList items={activity} live />
                        )}
                      </div>
                    </li>
                  )}
                </ol>
              )}
            </div>
          </section>
        )}

        {/* The bar itself never goes away. It is the composer, not a popup —
            which is why focusing it opens the transcript rather than a button
            having to be found and clicked first. */}
        <form
          className="kb-dock-bar"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <span aria-hidden="true" className="shrink-0 text-sm" style={{ color: "var(--kb-accent-a)" }}>
            ✦
          </span>

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setOpen(true)}
            disabled={busy}
            placeholder={listening ? "Listening…" : "Ask flow to do something…"}
            aria-label="Ask flow to do something"
            aria-keyshortcuts="Meta+K Control+K"
            className="kb-dock-input"
          />

          {!open && awaitingApproval > 0 && (
            <a
              href={`/dashboard/${tenantId}/agent`}
              className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold"
              style={{
                background: "var(--kb-tint-yellow)",
                color: "var(--kb-tint-yellow-ink)",
              }}
            >
              {awaitingApproval > 9 ? "9+" : awaitingApproval} waiting
            </a>
          )}

          {micSupported && (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              className={`kb-pill shrink-0 text-xs ${listening ? "kb-pill-primary" : "kb-pill-ghost"}`}
              aria-label={listening ? "Stop listening" : "Speak instead"}
            >
              🎤
            </button>
          )}

          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="kb-pill kb-pill-primary shrink-0 px-3.5 text-xs disabled:opacity-50"
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ActivityList({ items, live = false }: { items: Activity[]; live?: boolean }) {
  return (
    <ol className="space-y-1" aria-live={live ? "polite" : undefined}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug">
          <span
            aria-hidden="true"
            className="mt-[3px] shrink-0"
            style={{
              color:
                item.state === "held"
                  ? "var(--kb-tint-yellow-ink)"
                  : item.state === "done"
                    ? "var(--kb-tint-mint-ink)"
                    : "var(--kb-text-dim)",
            }}
          >
            {item.state === "done" ? "✓" : item.state === "held" ? "⏸" : "○"}
          </span>
          <span
            className={item.state === "running" ? "text-[var(--kb-text)]" : "text-[var(--kb-text-dim)]"}
          >
            {item.label}
            {item.state === "running" && "…"}
            {item.state === "held" && " — needs your approval"}
          </span>
        </li>
      ))}
    </ol>
  );
}
