// Fuel logging + anomaly detection — same statistics-not-LLM approach as
// inventory.ts: flag a fuel entry whose cost-per-litre deviates sharply
// from that same driver's own trailing average, rather than trying to
// guess a "normal" price globally.

import { prisma } from "@/lib/db";

export async function logFuel(params: {
  tenantId: string;
  driverId: string;
  litres: number;
  costCents: number;
  odometerKm?: number;
  notes?: string;
}) {
  return prisma.fuelLog.create({ data: params });
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
  const logs = await prisma.fuelLog.findMany({
    where: { tenantId },
    orderBy: { loggedAt: "asc" },
  });

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
