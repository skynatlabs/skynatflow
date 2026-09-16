import { moneyOf } from "@/lib/regions";
import { prisma } from "@/lib/db";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { listBankAccounts, reconciliationGap } from "@/lib/core/banking";
import { proposeMatches, listRules, type ProposedMatch } from "@/lib/core/reconciliation";
import { StatementImport } from "./StatementImport";
import {
  acceptMatchAction,
  addBankAccountAction,
  ignoreLineAction,
  rejectMatchAction,
} from "./actions";

export const dynamic = "force-dynamic";


function fmt(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The shortest honest description of a piece of text a person can use.
 *
 * Offered as the thing to remember when a match is accepted: a bank
 * description is full of reference numbers and dates that never repeat, and
 * remembering the whole string would produce a rule that never matches again.
 */
function suggestRuleText(description: string): string {
  const words = description
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  return words.slice(0, 2).join(" ");
}

// The formatter is passed in rather than reached for: a sub-component that
// formats money without being told whose it is is a geo-lock waiting to happen.
function ProposalRow({ p, tenantId, money }: { p: ProposedMatch; tenantId: string; money: (cents: number) => string }) {
  const moneyIn = p.amountCents > 0;
  const tone = moneyIn ? "var(--kb-tint-mint-ink)" : "var(--kb-text)";

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[var(--kb-text)]">{p.description}</p>
          <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{fmt(p.postedOn)}</p>
        </div>
        <span className="shrink-0 font-semibold tabular-nums" style={{ color: tone }}>
          {moneyIn ? "+" : ""}
          {money(p.amountCents)}
        </span>
      </div>

      {p.best ? (
        <div className="mt-3 rounded-md bg-[var(--kb-bg)] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--kb-text)]">{p.best.label}</p>
            <span className="kb-pill text-[10px] text-[var(--kb-text-dim)]">
              {p.best.confidence}% sure
            </span>
          </div>
          {/* The reasons, not the number. A percentage is not something anyone
              can check; "the amount matches and the name is in the description"
              is agreed or disagreed with in a second. */}
          <ul className="mt-1 space-y-0.5">
            {p.best.reasons.map((r) => (
              <li key={r} className="text-xs text-[var(--kb-text-dim)]">
                {r}
              </li>
            ))}
          </ul>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <form action={acceptMatchAction} className="flex flex-wrap items-center gap-1.5">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="bankTransactionId" value={p.bankTransactionId} />
              <input type="hidden" name="kind" value={p.best.kind} />
              <input type="hidden" name="targetId" value={p.best.id} />
              {p.best.kind === "account" && (
                <input
                  type="hidden"
                  name="rememberFor"
                  value={suggestRuleText(p.description)}
                />
              )}
              <SubmitButton pendingText="Posting…">That&apos;s right</SubmitButton>
            </form>

            <form action={rejectMatchAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="description" value={p.description} />
              <SubmitButton className="kb-pill kb-pill-ghost text-xs" pendingText="…">
                Wrong
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
          Nothing in the books looks like this one.
        </p>
      )}

      {p.alternatives.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-[var(--kb-text-dim)]">
            {p.alternatives.length} other possibilit
            {p.alternatives.length === 1 ? "y" : "ies"}
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {p.alternatives.map((alt) => (
              <li key={`${alt.kind}-${alt.id}`} className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-[var(--kb-text)]">{alt.label}</span>
                <form action={acceptMatchAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="bankTransactionId" value={p.bankTransactionId} />
                  <input type="hidden" name="kind" value={alt.kind} />
                  <input type="hidden" name="targetId" value={alt.id} />
                  <SubmitButton className="kb-pill kb-pill-ghost text-[11px]" pendingText="…">
                    This one
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      <form action={ignoreLineAction} className="mt-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="bankTransactionId" value={p.bankTransactionId} />
        <SubmitButton
          className="kb-pill kb-pill-ghost text-[11px] text-[var(--kb-text-dim)]"
          pendingText="…"
        >
          Not a business transaction
        </SubmitButton>
      </form>
    </li>
  );
}

export default async function BankingPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  // This workspace's own money, never the one the code was written in.
  const money = await moneyOf(tenantId);

  const accountCount = await prisma.account.count({ where: { tenantId } });
  const accounts = await listBankAccounts(tenantId);

  if (accountCount === 0) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Bank &amp; reconciliation</h1>
        <div className="kb-card mt-6 px-5 py-5">
          <p className="text-sm text-[var(--kb-text)]">
            Reconciling means matching the bank against your books, so the books have to exist
            first.
          </p>
          <a
            href={`/dashboard/${tenantId}/books`}
            className="mt-3 inline-block text-sm text-[var(--kb-accent)] hover:underline"
          >
            Open your books &rarr;
          </a>
        </div>
      </main>
    );
  }

  const [gaps, proposals, rules] = await Promise.all([
    Promise.all(accounts.map((a) => reconciliationGap(tenantId, a.id).then((g) => ({ a, g })))),
    accounts.length > 0 ? proposeMatches(tenantId, { limit: 40 }) : null,
    listRules(tenantId),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Bank &amp; reconciliation</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Every line on the statement gets matched to something in your books, or explained. Nothing
        is posted without you agreeing to it first.
      </p>

      {proposals && proposals.proposals.length > 0 && (
        <div className="kb-card mt-5 px-5 py-4">
          <p className="text-sm text-[var(--kb-text)]">{proposals.summary}</p>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {gaps.map(({ a, g }) => (
            <div key={a.id} className="kb-card px-5 py-4">
              <p className="font-semibold text-[var(--kb-text)]">
                {a.name}
                {a.last4 && (
                  <span className="text-[var(--kb-text-dim)]"> ····{a.last4}</span>
                )}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--kb-text-dim)]">
                Posts to {a.account.name}
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
                {g.unmatched}
              </p>
              <p className="text-[11px] text-[var(--kb-text-dim)]">
                still to explain, worth {money(Math.abs(g.unexplainedCents))}
              </p>
              {g.statementAt && (
                <p className="mt-1.5 text-[11px] text-[var(--kb-text-dim)]">
                  Statement to {fmt(g.statementAt)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {proposals && proposals.proposals.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">To explain</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {proposals.proposals.map((p) => (
              <ProposalRow key={p.bankTransactionId} p={p} tenantId={tenantId} money={money} />
            ))}
          </ul>
        </section>
      )}

      {proposals && proposals.proposals.length === 0 && accounts.length > 0 && (
        <div className="kb-card mt-8 px-5 py-5">
          <p className="text-sm text-[var(--kb-text)]">
            Nothing left to explain on the statements you&apos;ve imported.
          </p>
        </div>
      )}

      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <StatementImport
          tenantId={tenantId}
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, last4: a.last4 }))}
        />

        <div className="kb-card px-5 py-5">
          <h2 className="text-base font-semibold text-[var(--kb-text)]">
            {accounts.length === 0 ? "Add your bank account" : "Add another account"}
          </h2>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Just a name and the last four digits — we never ask for the rest of the number, and
            there is no reason this app should hold it.
          </p>
          <form action={addBankAccountAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <label className="block text-sm">
              <span className="block text-xs text-[var(--kb-text-dim)]">Name</span>
              <input
                name="name"
                required
                placeholder="FNB cheque"
                className="kb-input mt-1 w-44 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-[var(--kb-text-dim)]">Last 4</span>
              <input
                name="last4"
                inputMode="numeric"
                maxLength={4}
                placeholder="4821"
                className="kb-input mt-1 w-20 text-sm"
              />
            </label>
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </form>
        </div>
      </section>

      {rules.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">What it has learned</h2>
          <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
            Built from what you&apos;ve accepted and corrected. A rule you keep overruling stops
            being offered.
          </p>
          <div className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--kb-text)]">
                    &ldquo;{r.matchText}&rdquo; &rarr; {r.account.name}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--kb-text-dim)]">
                  used {r.timesApplied}
                  {r.timesOverruled > 0 ? `, overruled ${r.timesOverruled}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
