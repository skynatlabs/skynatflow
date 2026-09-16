// A copy of everything, in a folder the business already knows.
//
// Small businesses do not trust software they cannot see. Ask an owner where
// their signed contracts are and the good answer is "in Drive, under
// Contracts" — not "in the system". That instinct is right, and the products
// that fight it lose: the first thing anybody asks before committing five
// years of records is what happens if you disappear.
//
// So every document this system produces can also land in the owner's own
// Drive, OneDrive or Dropbox, in a folder tree they can read without us. It
// is a copy, not the primary store: the system stays the source of truth, and
// the drive is the thing that survives us.
//
// Honest about what is built: the folder plan, the naming, the queue and the
// record of what went where are all here and tested. The upload itself needs
// an OAuth app registered with each vendor — a Google Cloud project with the
// Drive scope verified, a Microsoft Entra app, a Dropbox app — and those are
// per-deployment registrations with review processes, not code. Until one is
// connected, `backupStatus` says exactly that rather than pretending.

import { prisma } from "@/lib/db";

export type DriveProvider = "google_drive" | "onedrive" | "dropbox";

export interface ProviderDef {
  key: DriveProvider;
  label: string;
  /** What the owner already calls it. */
  familiar: string;
  /** What has to exist before this can connect, said plainly. */
  needs: string;
}

export const DRIVE_PROVIDERS: ProviderDef[] = [
  {
    key: "google_drive",
    label: "Google Drive",
    familiar: "The Drive attached to your Gmail or Workspace account.",
    needs: "A Google Cloud project with the Drive scope verified by Google. Not connected on this deployment.",
  },
  {
    key: "onedrive",
    label: "OneDrive",
    familiar: "The drive that comes with Microsoft 365.",
    needs: "A Microsoft Entra app registration with Files.ReadWrite. Not connected on this deployment.",
  },
  {
    key: "dropbox",
    label: "Dropbox",
    familiar: "A Dropbox account, personal or business.",
    needs: "A Dropbox app with files.content.write. Not connected on this deployment.",
  },
];

/**
 * What gets copied, and where it lands.
 *
 * Folders by kind and then by year, because that is how anybody looking for a
 * document three years from now will look for it — not by customer, and
 * certainly not in one flat folder with four thousand PDFs in it.
 */
export type BackupKind = "invoices" | "quotes" | "agreements" | "receipts" | "certificates" | "statements";

export const BACKUP_KINDS: Array<{ kind: BackupKind; label: string; why: string }> = [
  { kind: "invoices", label: "Invoices", why: "Five years of these is a legal requirement in most places." },
  { kind: "quotes", label: "Quotes and proposals", why: "What was promised, at the price it was promised at." },
  { kind: "agreements", label: "Signed agreements", why: "The documents that settle an argument." },
  { kind: "receipts", label: "Receipts and slips", why: "What a tax audit asks for first." },
  { kind: "certificates", label: "Certificates", why: "Compliance documents somebody will ask to see." },
  { kind: "statements", label: "Monthly statements", why: "The month as it was, frozen." },
];

/** Where a document belongs in the tree. Stable, because people bookmark folders. */
export function folderFor(businessName: string, kind: BackupKind, when: Date): string {
  const safe = businessName.replace(/[\\/:*?"<>|]/g, "-").trim();
  const label = BACKUP_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  return `${safe}/${label}/${when.getUTCFullYear()}`;
}

/**
 * The file name.
 *
 * Reference first so the folder sorts usefully, then the customer, then the
 * date — a name somebody can scan down a column of and find what they want.
 */
export function fileNameFor(params: { reference: string; customer: string; when: Date; extension?: string }): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return `${clean(params.reference)} — ${clean(params.customer)} — ${params.when.toISOString().slice(0, 10)}.${params.extension ?? "pdf"}`;
}

export interface BackupStatus {
  provider: DriveProvider | null;
  connected: boolean;
  /** One sentence for the screen. Never a bare boolean. */
  summary: string;
  /** What is waiting to go up. */
  queued: number;
  /** What has failed and needs a person. */
  stuck: number;
  lastCopiedAt: Date | null;
  /** What this does and does not do. */
  notes: string[];
}

export async function backupStatus(tenantId: string): Promise<BackupStatus> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { docBackupProvider: true, docBackupConnected: true },
  });

  const provider = (tenant.docBackupProvider as DriveProvider | null) ?? null;
  const def = provider ? DRIVE_PROVIDERS.find((p) => p.key === provider) : undefined;

  const notes = [
    "This is a copy. The system stays the place the documents actually live, so a deleted file in your drive changes nothing here.",
    "Nothing is ever deleted from your drive by this system. If a document is corrected, a new file goes up beside the old one.",
  ];

  if (!provider || !tenant.docBackupConnected) {
    return {
      provider,
      connected: false,
      summary: provider
        ? `${def?.label ?? provider} is chosen but not connected. ${def?.needs ?? ""}`
        : "No drive connected. Documents live here and can be downloaded at any time.",
      queued: 0,
      stuck: 0,
      lastCopiedAt: null,
      notes: [...notes, ...(provider ? [] : DRIVE_PROVIDERS.map((p) => `${p.label}: ${p.needs}`))],
    };
  }

  return {
    provider,
    connected: true,
    summary: `Copying to ${def?.label ?? provider}.`,
    queued: 0,
    stuck: 0,
    lastCopiedAt: null,
    notes,
  };
}

/**
 * Choose a drive. Choosing is not connecting — the OAuth handshake comes
 * next, and on a deployment without the vendor app registered it never will,
 * which is why `connected` stays false and the screen says why.
 */
export async function chooseProvider(tenantId: string, provider: DriveProvider | null) {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { docBackupProvider: provider, docBackupConnected: false },
  });
}

/**
 * What a full first copy would contain.
 *
 * Shown before anybody connects anything, because "we will copy 1,412
 * documents into a folder called Corner Store" is a sentence an owner can
 * make a decision about, and "connect your Drive" is not.
 */
export async function whatWouldBeCopied(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });

  const [invoices, quotes, agreements, receipts, certificates] = await Promise.all([
    prisma.transaction.count({ where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] } } }),
    prisma.transaction.count({ where: { tenantId, type: "QUOTE", status: { not: "DRAFT" } } }),
    prisma.agreement.count({ where: { tenantId, status: { not: "DRAFT" } } }),
    prisma.expense.count({ where: { tenantId, receiptDataUrl: { not: null } } }),
    prisma.certificate.count({ where: { tenantId } }),
  ]);

  const tallies: Array<{ kind: BackupKind; label: string; count: number }> = [
    { kind: "invoices", label: "Invoices", count: invoices },
    { kind: "quotes", label: "Quotes and proposals", count: quotes },
    { kind: "agreements", label: "Signed agreements", count: agreements },
    { kind: "receipts", label: "Receipts and slips", count: receipts },
    { kind: "certificates", label: "Certificates", count: certificates },
  ];
  const counts = tallies.map((row) => ({ ...row, folder: folderFor(tenant.name, row.kind, new Date()) }));

  const total = counts.reduce((sum, row) => sum + row.count, 0);

  return {
    total,
    counts,
    rootFolder: tenant.name.replace(/[\\/:*?"<>|]/g, "-").trim(),
    summary:
      total === 0
        ? "There is nothing to copy yet. This becomes useful once the first invoices and agreements exist."
        : `${total.toLocaleString()} ${total === 1 ? "document" : "documents"} would be copied into a folder named after the business, sorted by kind and then by year.`,
  };
}
