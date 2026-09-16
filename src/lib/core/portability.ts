// Taking everything and leaving.
//
// Trust is built by the door being visibly unlocked. A business that can see
// its way out is a business willing to put its books, its compliance calendar
// and six years of history in — and stickiness that comes from being worth
// staying for is worth considerably more than stickiness that comes from
// being hard to leave.
//
// Two properties make this real rather than decorative:
//
//   IT IS COMPLETE. Every tenant-scoped table, not the four somebody
//   remembered. The manifest lists what was included AND what the schema
//   contains, so an export that silently stopped covering something new is
//   visible rather than discovered by whoever is migrating.
//
//   IT IS READABLE WITHOUT US. JSON for fidelity, CSV for the tables a
//   person will actually open in a spreadsheet. An export only this app can
//   read is not portability, it is a backup.

import { prisma } from "@/lib/db";

/**
 * Every tenant-scoped table, with how to pull it.
 *
 * Adding a model to the schema without adding it here is the failure this
 * feature is most prone to, which is why the coverage check below exists and
 * why the manifest reports the gap rather than hiding it.
 */
const EXPORTS: Array<{
  key: string;
  label: string;
  /** False for tables reached through a parent rather than by tenantId. */
  direct: boolean;
  fetch: (tenantId: string) => Promise<unknown[]>;
}> = [
  { key: "parties", label: "Customers and suppliers", direct: true, fetch: (t) => prisma.party.findMany({ where: { tenantId: t } }) },
  { key: "items", label: "Products and services", direct: true, fetch: (t) => prisma.item.findMany({ where: { tenantId: t } }) },
  // Who works here and in what role. The people's own logins live on User and
  // are deliberately not exported — those belong to them, not to the business.
  { key: "memberships", label: "Team members and their roles", direct: true, fetch: (t) => prisma.membership.findMany({ where: { tenantId: t } }) },
  { key: "transactions", label: "Quotes, invoices and payments", direct: true, fetch: (t) => prisma.transaction.findMany({ where: { tenantId: t } }) },
  { key: "transaction_lines", label: "Document line items", direct: false, fetch: (t) => prisma.transactionLine.findMany({ where: { transaction: { tenantId: t } } }) },
  { key: "expenses", label: "Expenses", direct: true, fetch: (t) => prisma.expense.findMany({ where: { tenantId: t } }) },
  { key: "accounts", label: "Chart of accounts", direct: true, fetch: (t) => prisma.account.findMany({ where: { tenantId: t } }) },
  { key: "journal_entries", label: "Journal entries", direct: true, fetch: (t) => prisma.journalEntry.findMany({ where: { tenantId: t } }) },
  { key: "journal_lines", label: "Journal lines", direct: false, fetch: (t) => prisma.journalLine.findMany({ where: { entry: { tenantId: t } } }) },
  { key: "accounting_periods", label: "Closed periods", direct: true, fetch: (t) => prisma.accountingPeriod.findMany({ where: { tenantId: t } }) },
  { key: "bank_accounts", label: "Bank accounts", direct: true, fetch: (t) => prisma.bankAccount.findMany({ where: { tenantId: t } }) },
  { key: "bank_transactions", label: "Bank statement lines", direct: true, fetch: (t) => prisma.bankTransaction.findMany({ where: { tenantId: t } }) },
  { key: "reconciliation_rules", label: "Reconciliation rules you taught it", direct: true, fetch: (t) => prisma.reconciliationRule.findMany({ where: { tenantId: t } }) },
  { key: "obligations", label: "Compliance calendar", direct: true, fetch: (t) => prisma.obligation.findMany({ where: { tenantId: t } }) },
  { key: "compliance_filings", label: "Filings recorded", direct: true, fetch: (t) => prisma.complianceFiling.findMany({ where: { tenantId: t } }) },
  { key: "assets", label: "Asset register", direct: true, fetch: (t) => prisma.asset.findMany({ where: { tenantId: t } }) },
  { key: "asset_movements", label: "Asset movement history", direct: true, fetch: (t) => prisma.assetMovement.findMany({ where: { tenantId: t } }) },
  { key: "leave_requests", label: "Leave", direct: true, fetch: (t) => prisma.leaveRequest.findMany({ where: { tenantId: t } }) },
  { key: "holidays", label: "Public holidays", direct: true, fetch: (t) => prisma.holiday.findMany({ where: { tenantId: t } }) },
  { key: "employment_records", label: "Employment records", direct: true, fetch: (t) => prisma.employmentRecord.findMany({ where: { tenantId: t } }) },
  { key: "progress_agreements", label: "Progress billing agreements", direct: true, fetch: (t) => prisma.progressAgreement.findMany({ where: { tenantId: t } }) },
  { key: "progress_claims", label: "Progress claims", direct: true, fetch: (t) => prisma.progressClaim.findMany({ where: { tenantId: t } }) },
  { key: "branches", label: "Branches", direct: true, fetch: (t) => prisma.branch.findMany({ where: { tenantId: t } }) },
  { key: "job_cards", label: "Job cards", direct: true, fetch: (t) => prisma.jobCard.findMany({ where: { tenantId: t } }) },
  { key: "tasks", label: "Tasks", direct: true, fetch: (t) => prisma.task.findMany({ where: { tenantId: t } }) },
  { key: "events", label: "Deliveries and site visits", direct: true, fetch: (t) => prisma.event.findMany({ where: { tenantId: t } }) },
  { key: "purchase_orders", label: "Purchase orders", direct: true, fetch: (t) => prisma.purchaseOrder.findMany({ where: { tenantId: t } }) },
  { key: "purchase_order_lines", label: "Purchase order lines", direct: false, fetch: (t) => prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { tenantId: t } } }) },
  { key: "fuel_logs", label: "Fuel logs", direct: true, fetch: (t) => prisma.fuelLog.findMany({ where: { tenantId: t } }) },
  { key: "time_entries", label: "Time and timesheets", direct: true, fetch: (t) => prisma.timeEntry.findMany({ where: { tenantId: t } }) },
  { key: "rentals", label: "Rentals", direct: true, fetch: (t) => prisma.rental.findMany({ where: { tenantId: t } }) },
  { key: "properties", label: "Properties", direct: true, fetch: (t) => prisma.property.findMany({ where: { tenantId: t } }) },
  { key: "leases", label: "Leases", direct: true, fetch: (t) => prisma.lease.findMany({ where: { tenantId: t } }) },
  { key: "stocktakes", label: "Stocktakes", direct: true, fetch: (t) => prisma.stocktake.findMany({ where: { tenantId: t } }) },
  { key: "notes", label: "Notes", direct: true, fetch: (t) => prisma.note.findMany({ where: { tenantId: t } }) },
  { key: "goals", label: "Goals", direct: true, fetch: (t) => prisma.goal.findMany({ where: { tenantId: t } }) },
  { key: "donations", label: "Donations", direct: true, fetch: (t) => prisma.donation.findMany({ where: { tenantId: t } }) },
  { key: "audit_logs", label: "Audit log", direct: true, fetch: (t) => prisma.auditLog.findMany({ where: { tenantId: t } }) },
  { key: "membership_involvements", label: "Member involvement history", direct: true, fetch: (t) => prisma.membershipInvolvement.findMany({ where: { tenantId: t } }) },
  { key: "tenant_pdf_templates", label: "Document designs", direct: true, fetch: (t) => prisma.tenantPdfTemplate.findMany({ where: { tenantId: t } }) },
  { key: "inbound_emails", label: "Inbound mail", direct: true, fetch: (t) => prisma.inboundEmail.findMany({ where: { tenantId: t } }) },
  { key: "notifications", label: "Notifications", direct: true, fetch: (t) => prisma.notification.findMany({ where: { tenantId: t } }) },
  { key: "ecommerce_orders", label: "Online store orders", direct: true, fetch: (t) => prisma.ecommerceOrder.findMany({ where: { tenantId: t } }) },
  { key: "payment_checkouts", label: "Payment checkouts", direct: true, fetch: (t) => prisma.paymentCheckout.findMany({ where: { tenantId: t } }) },
  { key: "till_sessions", label: "Till sessions", direct: true, fetch: (t) => prisma.tillSession.findMany({ where: { tenantId: t } }) },
  { key: "insurance_claims", label: "Insurance claims", direct: true, fetch: (t) => prisma.insuranceClaim.findMany({ where: { tenantId: t } }) },
  { key: "item_batches", label: "Stock batches", direct: true, fetch: (t) => prisma.itemBatch.findMany({ where: { tenantId: t } }) },
  { key: "recurring_invoices", label: "Recurring invoices", direct: true, fetch: (t) => prisma.recurringInvoice.findMany({ where: { tenantId: t } }) },
  { key: "proposal_templates", label: "Proposal templates", direct: true, fetch: (t) => prisma.proposalTemplate.findMany({ where: { tenantId: t } }) },
  { key: "comments", label: "Comments", direct: true, fetch: (t) => prisma.comment.findMany({ where: { tenantId: t } }) },
  { key: "disputes", label: "Disputes", direct: true, fetch: (t) => prisma.dispute.findMany({ where: { tenantId: t } }) },
  { key: "ai_drafts", label: "AI drafts", direct: true, fetch: (t) => prisma.aiDraft.findMany({ where: { tenantId: t } }) },
  { key: "message_threads", label: "Team message threads", direct: true, fetch: (t) => prisma.messageThread.findMany({ where: { tenantId: t } }) },
  { key: "agent_threads", label: "Conversations with the agent", direct: true, fetch: (t) => prisma.agentThread.findMany({ where: { tenantId: t } }) },
  { key: "agent_runs", label: "What the agent did", direct: true, fetch: (t) => prisma.agentRun.findMany({ where: { tenantId: t } }) },
  { key: "agent_definitions", label: "Agents you configured", direct: true, fetch: (t) => prisma.agentDefinition.findMany({ where: { tenantId: t } }) },
  { key: "tenant_facts", label: "What the agent learned about you", direct: true, fetch: (t) => prisma.tenantFact.findMany({ where: { tenantId: t } }) },
  { key: "domain_events", label: "Business event log", direct: true, fetch: (t) => prisma.domainEvent.findMany({ where: { tenantId: t } }) },
  { key: "observations", label: "What the officers noticed", direct: true, fetch: (t) => prisma.observation.findMany({ where: { tenantId: t } }) },
  { key: "officer_autonomy", label: "What each officer is allowed to do", direct: true, fetch: (t) => prisma.officerAutonomy.findMany({ where: { tenantId: t } }) },
  { key: "trips", label: "Trips", direct: true, fetch: (t) => prisma.trip.findMany({ where: { tenantId: t } }) },
  { key: "trip_stops", label: "Trip stops", direct: true, fetch: (t) => prisma.tripStop.findMany({ where: { tenantId: t } }) },
  // A person's movement, exported to the business that employs them and
  // reported on by nothing.
  { key: "trip_points", label: "Trip positions", direct: false, fetch: (t) => prisma.tripPoint.findMany({ where: { trip: { tenantId: t } } }) },
  { key: "expense_lines", label: "Slip line items", direct: false, fetch: (t) => prisma.expenseLine.findMany({ where: { expense: { tenantId: t } } }) },
  { key: "value_entries", label: "The value ledger", direct: true, fetch: (t) => prisma.valueEntry.findMany({ where: { tenantId: t } }) },
  { key: "incidents", label: "Incidents on the road", direct: true, fetch: (t) => prisma.incident.findMany({ where: { tenantId: t } }) },
  // What was read off the paperwork handed over while setting up — the
  // documents themselves were never kept, only the reading.
  { key: "intake_documents", label: "Documents read while setting up", direct: true, fetch: (t) => prisma.intakeDocument.findMany({ where: { tenantId: t } }) },
  { key: "delivery_notes", label: "Delivery notes", direct: true, fetch: (t) => prisma.deliveryNote.findMany({ where: { tenantId: t } }) },
  { key: "outbound_emails", label: "Mail sent", direct: true, fetch: (t) => prisma.outboundEmail.findMany({ where: { tenantId: t } }) },
  // Proposals and contracts, signatures and all. The one table in here a
  // business is most likely to be asked for by somebody else's attorney.
  { key: "agreements", label: "Proposals and contracts", direct: true, fetch: (t) => prisma.agreement.findMany({ where: { tenantId: t } }) },
  { key: "connected_systems", label: "The other systems you run", direct: true, fetch: (t) => prisma.connectedSystem.findMany({ where: { tenantId: t } }) },
  { key: "payment_plans", label: "Payment plans", direct: true, fetch: (t) => prisma.paymentPlan.findMany({ where: { tenantId: t } }) },
  { key: "supplier_bills", label: "Supplier bills", direct: true, fetch: (t) => prisma.supplierBill.findMany({ where: { tenantId: t } }) },
  { key: "payment_runs", label: "Payment runs", direct: true, fetch: (t) => prisma.paymentRun.findMany({ where: { tenantId: t } }) },
  { key: "vat_returns", label: "VAT returns", direct: true, fetch: (t) => prisma.vatReturn.findMany({ where: { tenantId: t } }) },
  { key: "collection_attempts", label: "Chasing history", direct: true, fetch: (t) => prisma.collectionAttempt.findMany({ where: { tenantId: t } }) },
  { key: "expense_coding_rules", label: "How you code your costs", direct: true, fetch: (t) => prisma.expenseCodingRule.findMany({ where: { tenantId: t } }) },
  { key: "contact_consents", label: "Who said you may contact them", direct: true, fetch: (t) => prisma.contactConsent.findMany({ where: { tenantId: t } }) },
  { key: "conversations", label: "Customer conversations and who owns them", direct: true, fetch: (t) => prisma.conversation.findMany({ where: { tenantId: t } }) },
  { key: "call_logs", label: "Calls", direct: true, fetch: (t) => prisma.callLog.findMany({ where: { tenantId: t } }) },
  { key: "lead_forms", label: "Enquiry forms", direct: true, fetch: (t) => prisma.leadForm.findMany({ where: { tenantId: t } }) },
  { key: "lead_submissions", label: "Enquiries", direct: true, fetch: (t) => prisma.leadSubmission.findMany({ where: { tenantId: t } }) },
  { key: "broadcasts", label: "Messages sent to many people at once", direct: true, fetch: (t) => prisma.broadcast.findMany({ where: { tenantId: t } }) },
  { key: "checklists", label: "Checklists", direct: true, fetch: (t) => prisma.checklist.findMany({ where: { tenantId: t } }) },
  { key: "certificates", label: "Certificates issued", direct: true, fetch: (t) => prisma.certificate.findMany({ where: { tenantId: t } }) },
  { key: "offline_changes", label: "Captured in the field", direct: true, fetch: (t) => prisma.offlineChange.findMany({ where: { tenantId: t } }) },
  { key: "agent_undo", label: "What the agent did that can be put back", direct: true, fetch: (t) => prisma.agentUndo.findMany({ where: { tenantId: t } }) },
  { key: "agent_spend", label: "What the agent cost", direct: true, fetch: (t) => prisma.agentSpend.findMany({ where: { tenantId: t } }) },
  // What customers sent in from their own portal link. The attachments are
  // inline data URLs, so the proof of payment travels with the record rather
  // than pointing at a file that will not be there.
  { key: "portal_submissions", label: "What customers sent from their portal", direct: true, fetch: (t) => prisma.portalSubmission.findMany({ where: { tenantId: t } }) },
  { key: "wholesale_connections", label: "Trading connections", direct: false, fetch: (t) => prisma.wholesaleConnection.findMany({ where: { OR: [{ supplierTenantId: t }, { buyerTenantId: t }] } }) },
];

/**
 * Tables deliberately left out, and why.
 *
 * Two kinds, and the first matters: several of these hold API keys, OAuth
 * refresh tokens and IMAP passwords, encrypted at rest. Putting them in a
 * file somebody emails to their new accountant would be the single worst
 * thing this feature could do — an export is a document that travels, and
 * credentials must not travel with it.
 *
 * Reconnecting an integration takes a minute. Recovering from a leaked
 * refresh token does not.
 */
const EXCLUDED: Record<string, string> = {
  pos_integrations: "Holds till provider credentials, encrypted at rest.",
  payment_gateways: "Holds payment gateway secret keys.",
  ecommerce_integrations: "Holds store API keys and webhook secrets.",
  email_accounts: "Holds mailbox passwords.",
  calendar_integrations: "Holds OAuth refresh tokens.",
  webhook_endpoints: "Holds signing secrets.",
  webhook_deliveries: "Delivery attempts against those endpoints; no business meaning without them.",
  api_keys: "Hashed API keys. Useless to import and dangerous to circulate.",
  voice_usage: "Platform metering, not business data.",
  field_syncs: "Delivery receipts for captures sent from a phone; the captures themselves are exported as trips, stops and events.",
  messages: "Exported through their threads.",
  transaction_lines: "Exported through their documents.",
  journal_lines: "Exported through their entries.",
  delivery_note_lines: "Exported through their delivery notes.",
  purchase_order_lines: "Exported through their purchase orders.",
  job_card_tasks: "Exported through their job cards.",
  progress_claims: "Exported alongside their agreements.",
  asset_movements: "Exported alongside their assets.",
  page_sections: "Exported through their pages.",
  agent_messages: "Exported through their threads.",
  payment_plan_instalments: "Exported through their plans.",
  fx_rates: "Exchange rates for a day, shared by every workspace and owned by none.",
  conversation_notes: "Exported through their conversations.",
  checklist_items: "Exported through their checklists.",
  agent_recipes: "A shared catalogue of agent templates. A workspace’s own published recipe is its words, not its data, and the catalogue is not scoped to one business.",
};

export const EXPORT_EXCLUSIONS = EXCLUDED;

export interface ExportTable {
  key: string;
  label: string;
  rows: number;
  /** Column names, so somebody can see the shape without opening the file. */
  columns: string[];
}

export interface ExportManifest {
  tenantId: string;
  businessName: string;
  exportedAt: string;
  format: "json";
  tables: ExportTable[];
  totalRows: number;
  /** Stated plainly rather than left for somebody to discover. */
  notes: string[];
}

export interface TenantExport {
  manifest: ExportManifest;
  data: Record<string, unknown[]>;
}

/**
 * Everything this workspace has, in one object.
 *
 * Deliberately not streamed or paginated. A small business's entire history
 * is a few megabytes, and an export somebody has to assemble from seventeen
 * paginated requests is not an export — it is an API with a promise attached.
 */
export async function exportTenant(tenantId: string): Promise<TenantExport> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  if (!tenant) throw new Error("Workspace not found.");

  const data: Record<string, unknown[]> = {};
  const tables: ExportTable[] = [];

  for (const spec of EXPORTS) {
    let rows: unknown[] = [];
    try {
      rows = await spec.fetch(tenantId);
    } catch {
      // One table failing must not cost somebody the other thirty-six. The
      // manifest records the gap rather than the export silently shrinking.
      tables.push({ key: spec.key, label: `${spec.label} — could not be read`, rows: 0, columns: [] });
      data[spec.key] = [];
      continue;
    }

    data[spec.key] = rows;
    tables.push({
      key: spec.key,
      label: spec.label,
      rows: rows.length,
      columns: rows.length > 0 ? Object.keys(rows[0] as object) : [],
    });
  }

  const totalRows = tables.reduce((s, t) => s + t.rows, 0);

  return {
    manifest: {
      tenantId,
      businessName: tenant.name,
      exportedAt: new Date().toISOString(),
      format: "json",
      tables,
      totalRows,
      notes: [
        "Amounts are integer cents. Divide by 100 for rands.",
        "Dates are ISO 8601 in UTC.",
        "Rows reference each other by id, exactly as they do in the database — a customer's id on an invoice is the id in the customers table.",
        "Attached files (signatures, receipt photographs, uploaded documents) are embedded as base64 data URLs on the rows that carry them, so nothing is left behind in storage you cannot reach.",
        "Staff logins are not included: those belong to the people, not to the business.",
        "Integration credentials — payment keys, mailbox passwords, OAuth tokens — are deliberately left out. An export is a document that travels, and those must not travel with it. Reconnecting an integration takes a minute.",
      ],
    },
    data,
  };
}

/**
 * One table as CSV.
 *
 * JSON preserves the structure; CSV is what somebody actually opens. Nested
 * values are serialised rather than flattened, because flattening invents a
 * shape the original did not have and the person importing has to undo it.
 */
export function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return "";

  const columns = [...new Set(rows.flatMap((r) => Object.keys(r as object)))];

  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    // Quote whenever the value could otherwise break the row.
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [columns.join(",")];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    lines.push(columns.map((c) => cell(record[c])).join(","));
  }
  return lines.join("\n");
}

export interface ExportCoverage {
  exported: string[];
  /** Tenant-scoped models in the schema that no export covers. */
  missing: string[];
  complete: boolean;
}

/**
 * Which tenant-scoped tables the export actually covers.
 *
 * Exists because this is the feature most likely to rot: somebody adds a
 * model, nobody adds it here, and the export quietly stops being complete
 * while still calling itself complete. The test that reads this is what keeps
 * the promise honest.
 */
export function exportCoverage(tenantScopedModels: string[]): ExportCoverage {
  const exported = EXPORTS.map((e) => e.key);
  // Table names in the schema are snake_case via @@map, and the export keys
  // deliberately match them so this comparison is a set operation rather than
  // a naming convention nobody remembers.
  const covered = new Set(exported);
  const missing = tenantScopedModels.filter((m) => !covered.has(m) && !(m in EXCLUDED));
  return { exported, missing, complete: missing.length === 0 };
}

export const EXPORT_KEYS = EXPORTS.map((e) => e.key);
