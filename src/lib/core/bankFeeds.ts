// The statement arriving by itself.
//
// A feed is not a second importer. It is the same statement reaching the same
// importer without anybody downloading a CSV and uploading it — so everything
// downstream is unchanged: the same fingerprint, the same duplicate handling,
// the same matcher, the same rules. That is deliberate. A feed with its own
// path through the books is a second set of behaviour to keep in step with
// the first, and it never stays in step.
//
// Providers are declared honestly. A provider with no adapter in this
// codebase says so in the list rather than appearing as a connect button that
// fails after somebody has fetched their bank credentials. Today that is all
// of them: the aggregators below need a commercial agreement and a client
// certificate before a single request can be made, so what is here is the
// shape they plug into and the manual import that works for everyone now.
//
// Auto-matching is off unless a workspace turns it on. A wrong entry posted
// automatically is found weeks later by somebody who did not make it.

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { importStatement } from "./banking";
import { acceptMatch, proposeMatches } from "./reconciliation";

export type FeedStatus = "adapter" | "needs-agreement";

export interface FeedProvider {
  key: string;
  label: string;
  /** Where it works. */
  region: string;
  status: FeedStatus;
  /** What a business has to do before this can be switched on. */
  needs: string;
}

export const FEED_PROVIDERS: FeedProvider[] = [
  {
    key: "stitch",
    label: "Stitch",
    region: "South Africa",
    status: "needs-agreement",
    needs: "A Stitch client id and secret, issued after a commercial agreement. Covers FNB, Absa, Standard Bank, Nedbank and Capitec.",
  },
  {
    key: "truelayer",
    label: "TrueLayer",
    region: "United Kingdom and Europe",
    status: "needs-agreement",
    needs: "A TrueLayer application with open-banking permissions.",
  },
  {
    key: "plaid",
    label: "Plaid",
    region: "United States and Canada",
    status: "needs-agreement",
    needs: "A Plaid client id and secret, and a production access request.",
  },
  {
    key: "investec",
    label: "Investec Programmable Banking",
    region: "South Africa",
    status: "needs-agreement",
    needs: "An Investec Private Banking account with the developer API enabled.",
  },
];

export const PROVIDER_BY_KEY: Record<string, FeedProvider> = Object.fromEntries(FEED_PROVIDERS.map((p) => [p.key, p]));

/**
 * What a provider adapter has to do, and all it has to do: hand back a
 * statement in the format the importer already reads.
 *
 * Making the boundary a CSV rather than a typed transaction list is not
 * laziness — it means a new provider is testable against the same fixtures as
 * a hand-uploaded statement, and that a bank whose API nobody has written yet
 * can still be supported by a person pasting the same text.
 */
export interface FeedAdapter {
  key: string;
  fetchStatementCsv(params: { accountRef: string; secret: string; since: Date }): Promise<string>;
}

const ADAPTERS = new Map<string, FeedAdapter>();

/** Registered by whichever module implements a provider. None do yet. */
export function registerAdapter(adapter: FeedAdapter) {
  ADAPTERS.set(adapter.key, adapter);
}

export function adapterFor(providerKey: string): FeedAdapter | null {
  return ADAPTERS.get(providerKey) ?? null;
}

export async function connectFeed(params: {
  tenantId: string;
  bankAccountId: string;
  provider: string;
  accountRef: string;
  secret: string;
  autoMatchAtOrAbove?: number | null;
}) {
  const provider = PROVIDER_BY_KEY[params.provider];
  if (!provider) throw new Error("There is no such feed provider.");

  const account = await prisma.bankAccount.findFirst({
    where: { id: params.bankAccountId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!account) throw new Error("That bank account is not in this workspace.");

  const threshold = params.autoMatchAtOrAbove ?? null;
  if (threshold !== null && (threshold < 80 || threshold > 100)) {
    // Below 80 a match is "these numbers are equal" and nothing more, which
    // is not a thing to post to the books without a person.
    throw new Error("Auto-matching can only be set between 80 and 100.");
  }

  return prisma.bankAccount.update({
    where: { id: params.bankAccountId },
    data: {
      feedProvider: provider.key,
      feedRef: params.accountRef.trim(),
      feedSecretEnc: encryptSecret(params.secret),
      feedConnectedAt: new Date(),
      feedError: null,
      autoMatchAtOrAbove: threshold,
    },
  });
}

export async function disconnectFeed(tenantId: string, bankAccountId: string) {
  const account = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, tenantId }, select: { id: true } });
  if (!account) throw new Error("That bank account is not in this workspace.");
  return prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: { feedProvider: null, feedRef: null, feedSecretEnc: null, feedConnectedAt: null, feedError: null },
  });
}

export async function setAutoMatch(tenantId: string, bankAccountId: string, atOrAbove: number | null) {
  if (atOrAbove !== null && (atOrAbove < 80 || atOrAbove > 100)) {
    throw new Error("Auto-matching can only be set between 80 and 100.");
  }
  const account = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, tenantId }, select: { id: true } });
  if (!account) throw new Error("That bank account is not in this workspace.");
  return prisma.bankAccount.update({ where: { id: bankAccountId }, data: { autoMatchAtOrAbove: atOrAbove } });
}

export interface SyncResult {
  bankAccountId: string;
  imported: number;
  duplicates: number;
  autoMatched: number;
  problems: string[];
  /** Said plainly when nothing could be fetched, rather than reported as a quiet zero. */
  error: string | null;
}

/**
 * Pull whatever is new and put it through the ordinary import.
 *
 * `since` defaults to a fortnight before the last sync rather than the last
 * sync itself: banks restate and backdate, and re-reading a fortnight costs
 * nothing because the fingerprint catches every line already held.
 */
export async function syncFeed(params: { tenantId: string; bankAccountId: string; now?: Date }): Promise<SyncResult> {
  const now = params.now ?? new Date();
  const account = await prisma.bankAccount.findFirst({
    where: { id: params.bankAccountId, tenantId: params.tenantId },
    select: { id: true, feedProvider: true, feedRef: true, feedSecretEnc: true, feedLastSyncAt: true, autoMatchAtOrAbove: true },
  });
  if (!account) throw new Error("That bank account is not in this workspace.");

  const base: SyncResult = { bankAccountId: account.id, imported: 0, duplicates: 0, autoMatched: 0, problems: [], error: null };
  if (!account.feedProvider || !account.feedRef || !account.feedSecretEnc) {
    return { ...base, error: "No feed is connected to this account." };
  }

  const adapter = adapterFor(account.feedProvider);
  if (!adapter) {
    const message = `${PROVIDER_BY_KEY[account.feedProvider]?.label ?? account.feedProvider} has no adapter in this build yet — import the statement by hand for now.`;
    await prisma.bankAccount.update({ where: { id: account.id }, data: { feedError: message } });
    return { ...base, error: message };
  }

  const since = new Date((account.feedLastSyncAt ?? new Date(now.getTime() - 90 * 86_400_000)).getTime() - 14 * 86_400_000);

  let csv: string;
  try {
    csv = await adapter.fetchStatementCsv({ accountRef: account.feedRef, secret: decryptSecret(account.feedSecretEnc), since });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The bank did not answer.";
    await prisma.bankAccount.update({ where: { id: account.id }, data: { feedError: message } });
    return { ...base, error: message };
  }

  const result = await importStatement({ tenantId: params.tenantId, bankAccountId: account.id, csv });
  const autoMatched = await autoMatch({ tenantId: params.tenantId, bankAccountId: account.id, atOrAbove: account.autoMatchAtOrAbove });

  await prisma.bankAccount.update({ where: { id: account.id }, data: { feedLastSyncAt: now, feedError: null } });
  return {
    bankAccountId: account.id,
    imported: result.imported,
    duplicates: result.duplicates,
    autoMatched,
    problems: result.problems,
    error: null,
  };
}

/**
 * Post the matches a workspace has said it trusts.
 *
 * Nothing happens without a threshold, and the threshold cannot be set below
 * 80. Each acceptance goes through the ordinary acceptMatch, so it posts the
 * same journal, learns the same rule, and is undone the same way.
 */
export async function autoMatch(params: { tenantId: string; bankAccountId?: string; atOrAbove: number | null }): Promise<number> {
  if (params.atOrAbove === null) return 0;

  const { proposals } = await proposeMatches(params.tenantId, { bankAccountId: params.bankAccountId, limit: 200 });
  let posted = 0;
  for (const proposal of proposals) {
    const best = proposal.best;
    if (!best || best.confidence < params.atOrAbove) continue;
    // A second candidate almost as good means the machine cannot tell them
    // apart, and picking one is a coin toss with somebody's books.
    const runnerUp = proposal.alternatives[0];
    if (runnerUp && best.confidence - runnerUp.confidence < 15) continue;

    try {
      await acceptMatch({
        tenantId: params.tenantId,
        bankTransactionId: proposal.bankTransactionId,
        kind: best.kind,
        targetId: best.id,
      });
      posted += 1;
    } catch (err) {
      // One line that will not post must not stop the rest of the statement.
      console.error(`[bankFeeds] auto-match failed on ${proposal.bankTransactionId}:`, err);
    }
  }
  return posted;
}

/** Every connected feed on a workspace, and whether it is actually working. */
export async function feedStatus(tenantId: string) {
  const accounts = await prisma.bankAccount.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      last4: true,
      feedProvider: true,
      feedConnectedAt: true,
      feedLastSyncAt: true,
      feedError: true,
      autoMatchAtOrAbove: true,
      lastStatementAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return accounts.map((a) => {
    const provider = a.feedProvider ? PROVIDER_BY_KEY[a.feedProvider] : null;
    const hasAdapter = a.feedProvider ? Boolean(adapterFor(a.feedProvider)) : false;
    return {
      bankAccountId: a.id,
      name: a.name,
      last4: a.last4,
      provider: provider?.label ?? null,
      connected: Boolean(a.feedConnectedAt),
      working: Boolean(a.feedConnectedAt) && hasAdapter && !a.feedError,
      lastSyncAt: a.feedLastSyncAt,
      lastStatementAt: a.lastStatementAt,
      autoMatchAtOrAbove: a.autoMatchAtOrAbove,
      note: !a.feedProvider
        ? "Imported by hand."
        : a.feedError
          ? a.feedError
          : hasAdapter
            ? "Feeding."
            : `${provider?.label ?? a.feedProvider} is connected but has no adapter in this build — import by hand for now.`,
    };
  });
}

/** Called by the cron. Every connected feed, one at a time, failures contained. */
export async function syncAllFeeds(now = new Date()): Promise<{ accounts: number; imported: number; autoMatched: number; failed: number }> {
  const accounts = await prisma.bankAccount.findMany({
    where: { feedProvider: { not: null }, isActive: true },
    select: { id: true, tenantId: true },
  });

  let imported = 0;
  let autoMatched = 0;
  let failed = 0;
  for (const account of accounts) {
    try {
      const result = await syncFeed({ tenantId: account.tenantId, bankAccountId: account.id, now });
      imported += result.imported;
      autoMatched += result.autoMatched;
      if (result.error) failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`[bankFeeds] sync failed for ${account.id}:`, err);
    }
  }
  return { accounts: accounts.length, imported, autoMatched, failed };
}
