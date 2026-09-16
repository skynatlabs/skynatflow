// The registry.
//
// One question this answers and nothing else: given a country, what is
// different? Everything that consumes it takes a `RegionPack` and adapts —
// no module anywhere asks "are we in South Africa".
//
// Adding a country is adding a file. It never touches a feature, and the test
// suite checks that: a pack that would need code changed to work is a pack
// that found a geo-lock, which is the point of having the shape at all.

import { prisma } from "@/lib/db";
import type { DateOrder, RegionPack, RegionalFeature } from "./types";
import { UNIVERSAL } from "./universal";
import { ZA } from "./packs/za";
import { US } from "./packs/us";
import { GB } from "./packs/gb";

export type { RegionPack, RegionalFeature, DateOrder, TaxRegime, TaxKind, NumberFormatRule, ProviderRef } from "./types";
export { UNIVERSAL } from "./universal";

const PACKS: RegionPack[] = [ZA, US, GB];

export const PACK_BY_COUNTRY: Record<string, RegionPack> = Object.fromEntries(PACKS.map((pack) => [pack.country, pack]));

/** Every country with a pack, for a settings screen that wants to say so. */
export const COVERED_COUNTRIES = PACKS.map((pack) => ({ country: pack.country, label: pack.label }));

/**
 * What is different about this country.
 *
 * A country with no pack gets the universal one, which is a working product
 * rather than a degraded one — the only things it lacks are local providers
 * and registry checks, and both are conveniences.
 */
export function regionFor(countryCode: string | null | undefined): RegionPack {
  if (!countryCode) return UNIVERSAL;
  return PACK_BY_COUNTRY[countryCode.toUpperCase()] ?? UNIVERSAL;
}

/** Whether a regional feature is on for this country. */
export function hasFeature(pack: RegionPack, feature: RegionalFeature): boolean {
  return pack.features.includes(feature);
}

/**
 * Everything a screen or a core module needs to speak this workspace's
 * language, in one query.
 *
 * The currency comes off the workspace rather than off the pack, because a
 * business can trade in a currency its country does not use — a Johannesburg
 * exporter billing in dollars is not unusual, and the pack is about the
 * country while the currency is about the business.
 */
export interface WorkspaceRegion {
  tenantId: string;
  country: string | null;
  pack: RegionPack;
  /** What this workspace's own money is written in. Always the workspace's. */
  currency: string;
  dateOrder: DateOrder;
  locale: string;
}

export async function regionOf(tenantId: string): Promise<WorkspaceRegion> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { countryCode: true, currency: true },
  });

  const pack = regionFor(tenant?.countryCode);
  return {
    tenantId,
    country: tenant?.countryCode ?? null,
    pack,
    currency: tenant?.currency ?? pack.currency,
    dateOrder: pack.dateOrder,
    locale: pack.locale,
  };
}

/**
 * A money formatter bound to one workspace.
 *
 * The shape every page and every core module should reach for: fetched once
 * per request, passed down, and impossible to use without having said whose
 * money it is.
 */
export async function moneyOf(tenantId: string): Promise<(cents: number, opts?: { decimals?: boolean }) => string> {
  const { currency } = await regionOf(tenantId);
  const { formatMoney } = await import("@/lib/format/money");
  return (cents, opts) => formatMoney(cents, currency, opts);
}

/**
 * Read a date the way this country writes it.
 *
 * The whole reason this exists: 03/04/2026 is the fourth of March in the
 * United States and the third of April almost everywhere else, and an
 * importer that assumes either one silently mis-dates a year of history.
 */
export function parseLocalDate(raw: string | undefined | null, order: DateOrder): Date | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  // An ISO date is unambiguous and is taken first, whatever the country.
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const parts = trimmed.match(/^(\d{1,4})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    let year = Number(parts[3]);
    if (parts[3].length === 2) year += year < 70 ? 2000 : 1900;

    let day: number;
    let month: number;
    if (order === "ymd") {
      return new Date(Date.UTC(a, b - 1, year, 12));
    } else if (order === "mdy") {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }

    // One unambiguous rescue: a value over twelve in the month position can
    // only be a day, whatever the country says. Somebody's export is in the
    // other order and reading it wrong would be worse than reading it.
    if (month > 12 && day <= 12) [day, month] = [month, day];

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month - 1, day, 12));
      if (!Number.isNaN(date.getTime())) return date;
    }
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** How this country writes a date, for a placeholder on a form. */
export function dateHint(order: DateOrder): string {
  return order === "mdy" ? "mm/dd/yyyy" : order === "ymd" ? "yyyy-mm-dd" : "dd/mm/yyyy";
}

/**
 * The tax year a date falls in, by the country's own reckoning.
 *
 * Named by the year it ends in where the year does not start in January,
 * which is the convention in every country that does it.
 */
export function taxYearOf(date: Date, pack: RegionPack): number {
  if (pack.taxYearStartMonth === 0) return date.getUTCFullYear();
  return date.getUTCMonth() >= pack.taxYearStartMonth ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

/** The period a tax return covers, from the country's own period length. */
export function taxPeriodFor(date: Date, pack: RegionPack): { start: Date; end: Date; label: string } {
  const months = Math.max(1, pack.tax.periodMonths);
  const year = date.getUTCFullYear();
  const first = Math.floor(date.getUTCMonth() / months) * months;

  const start = new Date(Date.UTC(year, first, 1));
  const end = new Date(Date.UTC(year, first + months, 0, 23, 59, 59, 999));

  const name = (month: number) => new Date(Date.UTC(year, month, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" });
  const label = months === 1 ? `${name(first)} ${year}` : `${name(first)}–${name(first + months - 1)} ${year}`;

  return { start, end, label };
}
