import { prisma } from "@/lib/db";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { obligationRadar, type RadarLine } from "@/lib/core/obligations";
import { jurisdictionStatus } from "@/lib/core/obligationLibrary";
import { listCountries, countryName } from "@/lib/core/countries";
import { DocumentIntake } from "./DocumentIntake";
import {
  addObligationAction,
  buildCalendarAction,
  completeObligationAction,
  rescheduleObligationAction,
  waiveObligationAction,
} from "./actions";

export const dynamic = "force-dynamic";

const KINDS = [
  ["COMPLIANCE_FILING", "Statutory filing"],
  ["LICENCE", "Licence or permit"],
  ["CERTIFICATE", "Certificate"],
  ["TAX", "Tax return"],
  ["INSURANCE", "Insurance"],
  ["CONTRACT", "Contract renewal"],
  ["WARRANTY", "Warranty"],
  ["DOCUMENT", "Person or vehicle document"],
] as const;

const RECURRENCES = [
  ["NONE", "One-off"],
  ["MONTHLY", "Every month"],
  ["BIMONTHLY", "Every two months"],
  ["QUARTERLY", "Every quarter"],
  ["BIANNUAL", "Twice a year"],
  ["ANNUAL", "Every year"],
] as const;

const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS);

function fmt(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** The number that goes big on the tile. Short enough to read at a glance. */
function countdown(line: RadarLine): { value: string; unit: string } {
  const d = line.daysUntil;
  if (d < 0) return { value: String(Math.abs(d)), unit: `day${Math.abs(d) === 1 ? "" : "s"} overdue` };
  if (d === 0) return { value: "Today", unit: "is the day" };
  if (d < 45) return { value: String(d), unit: `day${d === 1 ? "" : "s"} left` };
  const weeks = Math.round(d / 7);
  if (d < 365) return { value: String(weeks), unit: "weeks away" };
  return { value: String(Math.round(d / 30)), unit: "months away" };
}

// The accent is the whole point of a tile grid: state has to be readable
// before any of the words are.
const TONE: Record<string, { bg: string; ink: string }> = {
  OVERDUE: { bg: "var(--kb-tint-peach)", ink: "var(--kb-tint-peach-ink)" },
  DUE: { bg: "var(--kb-tint-peach)", ink: "var(--kb-tint-peach-ink)" },
  SOON: { bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  SCHEDULED: { bg: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
};

function ObligationTile({ line, tenantId }: { line: RadarLine; tenantId: string }) {
  const tone = TONE[line.state] ?? TONE.SCHEDULED;
  const { value, unit } = countdown(line);
  const hasNotice = line.actionByAt.getTime() !== line.dueAt.getTime();

  return (
    <article
      className="kb-card relative flex flex-col overflow-hidden p-0 transition-shadow hover:shadow-lg"
      style={{ borderTop: `3px solid ${tone.ink}` }}
    >
      <div className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--kb-text-dim)]">
              {KIND_LABEL[line.kind] ?? line.kind}
            </p>
            <h3 className="mt-0.5 font-semibold leading-snug text-[var(--kb-text)]">
              {line.title}
            </h3>
            {line.subject && (
              <p className="text-xs text-[var(--kb-text-dim)]">{line.subject.label}</p>
            )}
          </div>

          <div className="shrink-0 text-right">
            <div
              className="text-xl leading-none font-semibold tabular-nums"
              style={{ color: tone.ink }}
            >
              {value}
            </div>
            <div className="mt-0.5 text-[10px] whitespace-nowrap text-[var(--kb-text-dim)]">
              {unit}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {line.blocksWork && (
            <span
              className="kb-pill text-[10px] uppercase"
              style={{ background: "var(--kb-tint-peach)", color: "var(--kb-tint-peach-ink)" }}
              title="Work depending on this is refused while it is lapsed, not just flagged."
            >
              Stops work
            </span>
          )}
          {line.severity === "CRITICAL" && (
            <span
              className="kb-pill text-[10px] uppercase"
              style={{ background: "var(--kb-tint-violet)", color: "var(--kb-tint-violet-ink)" }}
            >
              Critical
            </span>
          )}
          {line.recurrence !== "NONE" && (
            <span className="kb-pill text-[10px] text-[var(--kb-text-dim)]">Repeats</span>
          )}
        </div>

        <p className="text-xs text-[var(--kb-text-dim)]">
          {line.authority ? `${line.authority} · ` : ""}
          {hasNotice ? (
            <>
              Notice by <strong>{fmt(line.actionByAt)}</strong>, renews {fmt(line.dueAt)}
            </>
          ) : (
            <>Due {fmt(line.dueAt)}</>
          )}
        </p>

        {line.consequence && (
          // Not truncated. This sentence is the only reason anybody acts on
          // the tile, and hiding it behind a tooltip defeats the feature.
          <p className="text-xs leading-relaxed text-[var(--kb-text-dim)]">{line.consequence}</p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-[var(--kb-panel-border)] px-5 py-2.5">
        <form action={completeObligationAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="obligationId" value={line.id} />
          <SubmitButton pendingText="Saving…">Mark done</SubmitButton>
        </form>

        <form action={rescheduleObligationAction} className="flex items-center gap-1">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="obligationId" value={line.id} />
          <input
            type="date"
            name="dueAt"
            defaultValue={iso(line.dueAt)}
            className="kb-input px-1.5 py-1 text-[11px]"
            aria-label={`Change the due date for ${line.title}`}
          />
          <SubmitButton className="kb-pill kb-pill-ghost text-[11px]" pendingText="…">
            Set
          </SubmitButton>
        </form>

        <form action={waiveObligationAction} className="ml-auto">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="obligationId" value={line.id} />
          <input type="hidden" name="reason" value="Marked as not applicable to this business." />
          <SubmitButton
            className="kb-pill kb-pill-ghost text-[11px] text-[var(--kb-text-dim)]"
            pendingText="…"
          >
            N/A
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}

function TileSection({
  title,
  blurb,
  lines,
  tenantId,
}: {
  title: string;
  blurb?: string;
  lines: RadarLine[];
  tenantId: string;
}) {
  if (lines.length === 0) return null;
  return (
    <section className="mt-8">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">{title}</h2>
        <span className="text-xs text-[var(--kb-text-dim)]">{lines.length}</span>
      </div>
      {blurb && <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{blurb}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {lines.map((l) => (
          <ObligationTile key={l.id} line={l} tenantId={tenantId} />
        ))}
      </div>
    </section>
  );
}

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { countryCode: true, regionCode: true },
  });

  const [radar, total, coverage] = await Promise.all([
    obligationRadar(tenantId),
    prisma.obligation.count({ where: { tenantId } }),
    tenant?.countryCode
      ? jurisdictionStatus(tenant.countryCode, tenant.regionCode)
      : Promise.resolve(null),
  ]);

  const empty = total === 0;
  const countries = listCountries();

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Compliance</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
            Everything this business owes somebody by a date, and what it costs to miss it. Watched
            continuously — you get told when something changes, not when you remember to look.
          </p>
        </div>
        {tenant?.countryCode && (
          <span className="kb-pill text-xs text-[var(--kb-text-dim)]">
            {countryName(tenant.countryCode)}
            {tenant.regionCode ? ` · ${tenant.regionCode}` : ""}
            {coverage ? ` · ${coverage.templateCount} known here` : ""}
          </span>
        )}
      </div>

      {!empty && (
        <div className="kb-card mt-5 px-5 py-4">
          {radar.summary ? (
            <p className="text-sm leading-relaxed text-[var(--kb-text)]">{radar.summary}</p>
          ) : (
            <p className="text-sm text-[var(--kb-text)]">
              Nothing needs you right now. {radar.scheduled.length} item
              {radar.scheduled.length === 1 ? "" : "s"} scheduled further out.
            </p>
          )}
        </div>
      )}

      {/* Setup. Two ways in, and the document one is the better one anywhere
          the library is thin — a licence names itself more reliably than any
          list we could ship. */}
      {empty && (
        <section className="mt-6 grid gap-3 lg:grid-cols-2">
          <div className="kb-card px-5 py-5">
            <h2 className="text-base font-semibold text-[var(--kb-text)]">
              Build it from where you are
            </h2>
            <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
              Tell us where the business is registered and what it does. We know what applies in a
              growing number of places — and where we don&apos;t yet, we&apos;ll work it out and
              remember it for the next business from there.
            </p>
            <form action={buildCalendarAction} className="mt-4 space-y-3">
              <input type="hidden" name="tenantId" value={tenantId} />

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">Country</span>
                  <select
                    name="countryCode"
                    required
                    defaultValue={tenant?.countryCode ?? ""}
                    className="kb-input mt-1 w-full text-sm"
                  >
                    <option value="">Choose…</option>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">
                    State or province <span className="opacity-70">— if it changes what you owe</span>
                  </span>
                  <input
                    name="regionCode"
                    defaultValue={tenant?.regionCode ?? ""}
                    placeholder="TX, ON, GP…"
                    className="kb-input mt-1 w-full text-sm"
                  />
                </label>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm text-[var(--kb-text)]">
                  <input type="checkbox" name="isCompany" defaultChecked />
                  Registered company
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--kb-text)]">
                  <input type="checkbox" name="isVatRegistered" />
                  Registered for VAT / GST / sales tax
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--kb-text)]">
                  <input type="checkbox" name="hasEmployees" />
                  I employ people
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--kb-text)]">
                  <input type="checkbox" name="hasVehicles" />
                  The business runs vehicles
                </label>
              </div>

              <label className="block text-sm">
                <span className="block text-xs text-[var(--kb-text-dim)]">
                  Month the business was registered — some deadlines follow that anniversary
                </span>
                <select name="registrationMonth" className="kb-input mt-1 w-56 text-sm">
                  <option value="">I don&apos;t know yet</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {new Date(Date.UTC(2026, i, 1)).toLocaleString(undefined, { month: "long" })}
                    </option>
                  ))}
                </select>
              </label>

              <SubmitButton pendingText="Building…">Build my calendar</SubmitButton>
            </form>
          </div>

          <DocumentIntake tenantId={tenantId} />
        </section>
      )}

      {radar.blocking.length > 0 && (
        <TileSection
          title="Stopping work right now"
          blurb="Lapsed, and set to refuse the work that depends on them rather than warn about it."
          lines={radar.blocking}
          tenantId={tenantId}
        />
      )}

      <TileSection
        title="Overdue"
        blurb="Past the date. The longer these sit, the more expensive they get."
        lines={radar.overdue.filter((l) => !l.blocksWork)}
        tenantId={tenantId}
      />
      <TileSection title="Due today" lines={radar.due} tenantId={tenantId} />
      <TileSection
        title="Coming up"
        blurb="Inside the window where there is still time to do something about it."
        lines={radar.soon}
        tenantId={tenantId}
      />
      <TileSection
        title="Scheduled"
        blurb="Far enough out that nothing needs doing yet. Kept visible so the calendar is checkable, not a black box."
        lines={radar.scheduled}
        tenantId={tenantId}
      />

      {!empty && (
        <section className="mt-10 grid gap-3 lg:grid-cols-2">
          <DocumentIntake tenantId={tenantId} />

          <div className="kb-card px-5 py-5">
            <h2 className="text-base font-semibold text-[var(--kb-text)]">Add one yourself</h2>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
              Anything with a date and a consequence: a permit, a policy, a contract you must give
              notice on, a certification that expires.
            </p>
            <form action={addObligationAction} className="mt-3 space-y-3">
              <input type="hidden" name="tenantId" value={tenantId} />

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">What is it</span>
                  <input
                    name="title"
                    required
                    placeholder="Public liability insurance"
                    className="kb-input mt-1 w-full text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">Who requires it</span>
                  <input
                    name="authority"
                    placeholder="Insurer, the tax office, a council…"
                    className="kb-input mt-1 w-full text-sm"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">Type</span>
                  <select name="kind" className="kb-input mt-1 w-full text-sm">
                    {KINDS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">Due</span>
                  <input type="date" name="dueAt" required className="kb-input mt-1 w-full text-sm" />
                </label>
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">Repeats</span>
                  <select name="recurrence" className="kb-input mt-1 w-full text-sm">
                    {RECURRENCES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">How bad if missed</span>
                  <select
                    name="severity"
                    defaultValue="MEDIUM"
                    className="kb-input mt-1 w-full text-sm"
                  >
                    <option value="CRITICAL">Critical — we stop trading</option>
                    <option value="HIGH">High — locked out of work</option>
                    <option value="MEDIUM">Medium — penalty or fine</option>
                    <option value="LOW">Low — tidiness</option>
                  </select>
                </label>
              </div>

              <label className="block text-sm">
                <span className="block text-xs text-[var(--kb-text-dim)]">
                  What happens if it is missed — this is the sentence you&apos;ll be shown when it
                  comes due
                </span>
                <input
                  name="consequence"
                  placeholder="Cover lapses and we cannot start on site."
                  className="kb-input mt-1 w-full text-sm"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="block text-xs text-[var(--kb-text-dim)]">
                    Notice days, for a contract that renews itself
                  </span>
                  <input
                    type="number"
                    name="noticeDays"
                    min={1}
                    placeholder="60"
                    className="kb-input mt-1 w-full text-sm"
                  />
                </label>
                <label className="flex items-end gap-2 pb-1.5 text-sm text-[var(--kb-text)]">
                  <input type="checkbox" name="blocksWork" />
                  <span>
                    Refuse dependent work while lapsed
                    <span className="block text-xs text-[var(--kb-text-dim)]">
                      For a driving permit or liability cover, where carrying on is the real risk.
                    </span>
                  </span>
                </label>
              </div>

              <SubmitButton pendingText="Adding…">Add to the calendar</SubmitButton>
            </form>
          </div>
        </section>
      )}
    </main>
  );
}
