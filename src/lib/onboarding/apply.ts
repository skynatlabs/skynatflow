// Writing down what the owner confirmed.
//
// The reading side proposes; this is the only thing that writes. Two rules
// make it safe to run again tomorrow with the same price list: nothing is
// duplicated — a product already here by code or by name is updated, not
// added twice — and nothing already recorded is blanked by a document that
// happened to be quiet about it.

import { ObligationKind, PartyRole, type NicheSkin } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { adoptFromDocument, buildCalendarFromLibrary } from "@/lib/core/obligationLibrary";
import { CURRENCY_FOR_COUNTRY } from "@/lib/format/money";
import { normalise, type AcceptedProposal, type ProposedParty, type ProposedProduct } from "./proposal";

export interface ApplyResult {
  businessFields: number;
  bankingFields: number;
  obligations: number;
  calendarAdded: number;
  customersCreated: number;
  customersUpdated: number;
  suppliersCreated: number;
  suppliersUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  problems: string[];
}

const TENANT_TEXT_FIELDS = [
  "name",
  "registrationNumber",
  "entityType",
  "vatNumber",
  "businessAddress",
  "businessEmail",
  "businessPhone",
  "bankName",
  "bankAccountHolder",
  "bankAccountNumber",
  "bankBranchCode",
  "bankSwift",
] as const;

const trim = (v: string | undefined) => (typeof v === "string" ? v.trim() : "");

/**
 * Products, by code where there is one and by name where there is not.
 * Quantities replace what is on hand; prices and costs fill in or correct.
 */
export async function upsertProducts(
  tenantId: string,
  products: ProposedProduct[]
): Promise<{ created: number; updated: number }> {
  const wanted = products.filter((p) => p.name?.trim());
  if (wanted.length === 0) return { created: 0, updated: 0 };

  const existing = await prisma.item.findMany({
    where: { tenantId },
    select: { id: true, name: true, sku: true, unitPriceCents: true, costCents: true, stockQty: true, taxRatePercent: true, category: true, unit: true },
  });
  const bySku = new Map(existing.filter((e) => e.sku).map((e) => [normalise(e.sku), e]));
  const byName = new Map(existing.map((e) => [normalise(e.name), e]));

  let created = 0;
  let updated = 0;
  for (const p of wanted) {
    const match = (p.sku && bySku.get(normalise(p.sku))) || byName.get(normalise(p.name));
    if (match) {
      const data = {
        sku: match.sku ?? p.sku ?? undefined,
        unit: match.unit ?? p.unit ?? undefined,
        unitPriceCents: p.unitPriceCents ?? undefined,
        costCents: p.costCents ?? undefined,
        stockQty: p.quantityOnHand ?? undefined,
        taxRatePercent: p.taxRatePercent ?? match.taxRatePercent ?? undefined,
        category: match.category ?? p.category ?? undefined,
      };
      await prisma.item.update({ where: { id: match.id }, data });
      updated++;
      continue;
    }
    const item = await prisma.item.create({
      data: {
        tenantId,
        name: p.name.trim(),
        sku: p.sku ?? undefined,
        unit: p.unit ?? undefined,
        // A catalogue entry with no price yet is still worth having: it is
        // named on the first quote, and the price is set there.
        unitPriceCents: p.unitPriceCents ?? 0,
        costCents: p.costCents ?? undefined,
        stockQty: p.quantityOnHand ?? undefined,
        taxRatePercent: p.taxRatePercent ?? undefined,
        category: p.category ?? undefined,
      },
      select: { id: true, name: true, sku: true },
    });
    created++;
    byName.set(normalise(item.name), { ...item, unitPriceCents: 0, costCents: null, stockQty: null, taxRatePercent: null, category: null, unit: null });
    if (item.sku) bySku.set(normalise(item.sku), { ...item, unitPriceCents: 0, costCents: null, stockQty: null, taxRatePercent: null, category: null, unit: null });
  }
  return { created, updated };
}

/** Customers and suppliers, by email where there is one and by name where there is not. */
export async function upsertParties(
  tenantId: string,
  parties: ProposedParty[],
  role: PartyRole
): Promise<{ created: number; updated: number }> {
  const wanted = parties.filter((p) => p.name?.trim());
  if (wanted.length === 0) return { created: 0, updated: 0 };

  const existing = await prisma.party.findMany({
    where: { tenantId, role },
    select: { id: true, name: true, email: true, phone: true, companyName: true, vatNumber: true, addressLine: true },
  });
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [normalise(e.email), e]));
  const byName = new Map(existing.map((e) => [normalise(e.name), e]));

  let created = 0;
  let updated = 0;
  for (const p of wanted) {
    const match = (p.email && byEmail.get(normalise(p.email))) || byName.get(normalise(p.name));
    if (match) {
      const data = {
        email: match.email ?? p.email ?? undefined,
        phone: match.phone ?? p.phone ?? undefined,
        companyName: match.companyName ?? p.companyName ?? undefined,
        vatNumber: match.vatNumber ?? p.vatNumber ?? undefined,
        addressLine: match.addressLine ?? p.address ?? undefined,
      };
      const changed = Object.entries(data).some(([k, v]) => v !== undefined && v !== (match as Record<string, unknown>)[k]);
      if (changed) {
        await prisma.party.update({ where: { id: match.id }, data });
        updated++;
      }
      continue;
    }
    const party = await createParty({
      tenantId,
      role,
      name: p.name.trim(),
      email: p.email ?? undefined,
      phone: p.phone ?? undefined,
      companyName: p.companyName ?? undefined,
      vatNumber: p.vatNumber ?? undefined,
      addressLine: p.address ?? undefined,
    });
    created++;
    byName.set(normalise(party.name), { id: party.id, name: party.name, email: party.email, phone: party.phone, companyName: party.companyName, vatNumber: party.vatNumber, addressLine: party.addressLine });
    if (party.email) byEmail.set(normalise(party.email), { id: party.id, name: party.name, email: party.email, phone: party.phone, companyName: party.companyName, vatNumber: party.vatNumber, addressLine: party.addressLine });
  }
  return { created, updated };
}

const looksIncorporated = (entityType: string | undefined) =>
  /\b(pty|ltd|limited|inc|incorporated|cc|close corporation|npc|npo|company|gmbh|bv|llc)\b/i.test(entityType ?? "");

/** Write the accepted proposal into the workspace. */
export async function applyProposal(tenantId: string, accepted: AcceptedProposal): Promise<ApplyResult> {
  const result: ApplyResult = {
    businessFields: 0,
    bankingFields: 0,
    obligations: 0,
    calendarAdded: 0,
    customersCreated: 0,
    customersUpdated: 0,
    suppliersCreated: 0,
    suppliersUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    problems: [],
  };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, niche: true, countryCode: true, currency: true, vatNumber: true, entityType: true },
  });
  if (!tenant) throw new Error("That workspace no longer exists.");

  // ---------------------------------------------------------------- details
  const fields = { ...accepted.business, ...accepted.banking } as Record<string, string | undefined>;
  const data: Record<string, string> = {};
  for (const key of TENANT_TEXT_FIELDS) {
    const value = trim(fields[key]);
    if (value) data[key] = value;
  }
  const country = trim(fields.countryCode).toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) {
    data.countryCode = country;
    // The currency follows the country, unless the business already trades in
    // one somebody chose.
    const currency = CURRENCY_FOR_COUNTRY[country];
    if (currency && tenant.currency === "ZAR" && country !== "ZA") data.currency = currency;
  }
  if (Object.keys(data).length > 0) {
    await prisma.tenant.update({ where: { id: tenantId }, data });
    result.businessFields = Object.keys(data).filter((k) => !k.startsWith("bank")).length;
    result.bankingFields = Object.keys(data).filter((k) => k.startsWith("bank")).length;
  }

  // ----------------------------------------------------------- certificates
  if (accepted.obligations.length > 0) {
    const have = new Set(
      (await prisma.obligation.findMany({ where: { tenantId }, select: { title: true } })).map((o) => normalise(o.title))
    );
    for (const o of accepted.obligations) {
      if (!o.title?.trim() || have.has(normalise(o.title))) continue;
      try {
        await adoptFromDocument({
          tenantId,
          title: o.title.trim(),
          kind: (Object.values(ObligationKind) as string[]).includes(o.kind) ? (o.kind as ObligationKind) : ObligationKind.CERTIFICATE,
          authority: o.authority,
          reference: o.reference,
          expiresOn: o.expiresOn ? new Date(`${o.expiresOn}T12:00:00.000Z`) : null,
          countryCode: data.countryCode ?? tenant.countryCode ?? null,
        });
        have.add(normalise(o.title));
        result.obligations++;
      } catch (err) {
        result.problems.push(`${o.title}: ${err instanceof Error ? err.message : "could not be added to the calendar."}`);
      }
    }
  }

  // ------------------------------------------------------- the whole calendar
  if (accepted.buildCalendar) {
    const countryCode = data.countryCode ?? tenant.countryCode;
    if (!countryCode) {
      result.problems.push("The compliance calendar needs to know which country the business is in.");
    } else {
      const [staff, vehicles] = await Promise.all([
        prisma.membership.count({ where: { tenantId } }),
        prisma.asset.count({ where: { tenantId, capacityUnit: "KM" } }),
      ]);
      const registeredOn = trim(accepted.business.registeredOn);
      const month = /^\d{4}-(\d{2})/.exec(registeredOn)?.[1];
      try {
        const built = await buildCalendarFromLibrary(tenantId, {
          countryCode,
          isCompany: looksIncorporated(data.entityType ?? tenant.entityType ?? undefined),
          isVatRegistered: Boolean(data.vatNumber ?? tenant.vatNumber),
          hasEmployees: staff > 1,
          hasVehicles: vehicles > 0 || (tenant.niche as NicheSkin) === "LOGISTICS",
          registrationMonth: month ? Number(month) : null,
        });
        result.calendarAdded = built.created;
        if (built.jurisdictionEmpty) {
          result.problems.push("Nothing is on file yet for this country's filings — add the ones you know on the compliance page.");
        }
      } catch (err) {
        result.problems.push(err instanceof Error ? err.message : "The compliance calendar could not be built.");
      }
    }
  }

  // ------------------------------------------------- customers and suppliers
  const customerRole = tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER;
  const customers = await upsertParties(tenantId, accepted.customers, customerRole);
  result.customersCreated = customers.created;
  result.customersUpdated = customers.updated;
  const suppliers = await upsertParties(tenantId, accepted.suppliers, PartyRole.SUPPLIER);
  result.suppliersCreated = suppliers.created;
  result.suppliersUpdated = suppliers.updated;

  const products = await upsertProducts(tenantId, accepted.products);
  result.productsCreated = products.created;
  result.productsUpdated = products.updated;

  return result;
}

/** What the owner is told after it is written down. */
export function describeApplied(r: ApplyResult): string[] {
  const lines: string[] = [];
  const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
  if (r.businessFields) lines.push(`${n(r.businessFields, "business detail")} saved.`);
  if (r.bankingFields) lines.push(`Your banking details saved — invoices now say where to pay.`);
  if (r.obligations || r.calendarAdded) lines.push(`${n(r.obligations + r.calendarAdded, "date")} on your compliance calendar.`);
  if (r.productsCreated) lines.push(`${n(r.productsCreated, "product")} added.`);
  if (r.productsUpdated) lines.push(`${n(r.productsUpdated, "product")} updated.`);
  if (r.customersCreated) lines.push(`${n(r.customersCreated, "customer")} added.`);
  if (r.customersUpdated) lines.push(`${n(r.customersUpdated, "customer")} updated.`);
  if (r.suppliersCreated) lines.push(`${n(r.suppliersCreated, "supplier")} added.`);
  if (lines.length === 0) lines.push("Nothing new to add — it was all here already.");
  return lines;
}
