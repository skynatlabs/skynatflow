// Fuel logging + anomaly detection — same statistics-not-LLM approach as
// inventory.ts: flag a fuel entry whose cost-per-litre deviates sharply
// from that same driver's own trailing average, rather than trying to
// guess a "normal" price globally.
//
// A fill-up is also money leaving, and for a long time this was the one place
// in the product where money left without the books hearing about it. One
// capture now writes both: the expense, tagged to the vehicle and carrying the
// odometer reading, and the fuel log that the anomaly check reads.

import { ExpenseSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { submitExpense } from "./expenses";

/** The chart's vehicle-and-fuel account. */
export const FUEL_ACCOUNT_CODE = "5300";

export async function logFuel(params: {
  tenantId: string;
  driverId: string;
  litres: number;
  costCents: number;
  odometerKm?: number;
  notes?: string;
  /** Which vehicle. Without it the litres can never become a cost per kilometre. */
  assetId?: string | null;
  tripId?: string | null;
  supplierName?: string | null;
  reference?: string | null;
  receiptDataUrl?: string;
  source?: ExpenseSource;
  loggedAt?: Date;
  /** Who typed it, when that is not the driver. Defaults to the driver. */
  submittedById?: string;
}) {
  if (!(params.litres > 0)) throw new Error("How many litres?");
  if (!(params.costCents > 0)) throw new Error("What did it cost?");

  const loggedAt = params.loggedAt ?? new Date();

  const expense = await submitExpense({
    tenantId: params.tenantId,
    submittedById: params.submittedById ?? params.driverId,
    incurredById: params.driverId,
    descriptionText: `Fuel — ${params.litres.toLocaleString("en-US", { maximumFractionDigits: 1 })} L`,
    amountCents: params.costCents,
    category: "Fuel",
    accountCode: FUEL_ACCOUNT_CODE,
    spentOn: loggedAt,
    source: params.source ?? ExpenseSource.STAFF_APP,
    assetId: params.assetId ?? null,
    tripId: params.tripId ?? null,
    supplierName: params.supplierName ?? null,
    reference: params.reference ?? null,
    receiptDataUrl: params.receiptDataUrl,
    quantity: params.litres,
    unit: "L",
    odometerKm: params.odometerKm ?? null,
    // Fuel for a business vehicle is a business cost. Saying so here spares
    // the owner a question the answer to which is always the same.
    isOwnerDrawing: params.assetId ? false : null,
  });

  const log = await prisma.fuelLog.create({
    data: {
      tenantId: params.tenantId,
      driverId: params.driverId,
      litres: params.litres,
      costCents: params.costCents,
      odometerKm: params.odometerKm,
      notes: params.notes,
      loggedAt,
      assetId: expense.assetId,
      expenseId: expense.id,
    },
  });

  return { ...log, expense };
}

export interface FuelAnomaly {
  logId: string;
  driverId: string;
  driverName: string;
  costPerLitre: number;
  driverAvgCostPerLitre: number;
  deviationPercent: number;
  loggedAt: Date;
}

export async function getFuelAnomalies(tenantId: string, thresholdPercent = 25): Promise<FuelAnomaly[]> {
  // Most recent 1000 fills, oldest-first for the per-driver rolling
  // average below — anomaly detection should weigh recent behavior, not
  // get swamped by a fleet's entire multi-year fuel history.
  const recentLogs = await prisma.fuelLog.findMany({
    where: { tenantId },
    orderBy: { loggedAt: "desc" },
    take: 1000,
  });
  const logs = recentLogs.reverse();

  const byDriver = new Map<string, typeof logs>();
  for (const log of logs) {
    const arr = byDriver.get(log.driverId) ?? [];
    arr.push(log);
    byDriver.set(log.driverId, arr);
  }

  const memberships = await prisma.membership.findMany({
    where: { id: { in: Array.from(byDriver.keys()) } },
    include: { user: true },
  });
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));

  const anomalies: FuelAnomaly[] = [];
  for (const [driverId, driverLogs] of byDriver) {
    const costsPerLitre = driverLogs.map((l) => l.costCents / l.litres);
    const avg = costsPerLitre.reduce((a, b) => a + b, 0) / costsPerLitre.length;

    driverLogs.forEach((log, i) => {
      const costPerLitre = costsPerLitre[i];
      const deviationPercent = avg > 0 ? ((costPerLitre - avg) / avg) * 100 : 0;
      if (Math.abs(deviationPercent) >= thresholdPercent) {
        anomalies.push({
          logId: log.id,
          driverId,
          driverName: nameById.get(driverId) ?? "Someone",
          costPerLitre,
          driverAvgCostPerLitre: avg,
          deviationPercent,
          loggedAt: log.loggedAt,
        });
      }
    });
  }

  return anomalies.sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime());
}
