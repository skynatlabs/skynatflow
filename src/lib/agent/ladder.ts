// What an officer may do on its own.
//
// Five rungs, and the gaps between them are where the trust is. A person
// raising an officer from SUGGEST to DRAFT is agreeing that it may write
// things; raising it to ACT is agreeing that it may change things. Those are
// different decisions and deserve different switches, which is why this is
// per officer rather than one setting for the whole workspace.
//
// The ceiling is enforced where the action happens, never in a prompt. A
// model told it may not do something will mostly not do it; a model that
// cannot reach the code path cannot do it at all, and only the second is
// worth anything when the subject is money.

import { prisma } from "@/lib/db";
import { Officer } from "@prisma/client";

/**
 * The rungs, in order. Each includes everything below it.
 *
 *  OBSERVE  write a finding to the bus; never seen unless the coordinator
 *           raises it
 *  SUGGEST  may be raised to a person as something to consider
 *  DRAFT    may compose something — a message, an entry, a reprice — that a
 *           person then sends or posts
 *  PROPOSE  may stage a real action, held pending approval, one click from
 *           happening
 *  ACT      may carry out reversible work unaided
 */
export const RUNGS = ["OBSERVE", "SUGGEST", "DRAFT", "PROPOSE", "ACT"] as const;
export type Rung = (typeof RUNGS)[number];

export const RUNG_LABELS: Record<Rung, string> = {
  OBSERVE: "Notices things, says nothing",
  SUGGEST: "Can raise things with you",
  DRAFT: "Can write, you send",
  PROPOSE: "Can stage actions for one-click approval",
  ACT: "Can do reversible work on its own",
};

function rungIndex(rung: string): number {
  const i = RUNGS.indexOf(rung as Rung);
  // An unrecognised stored value falls to the most cautious rung rather than
  // the most permissive. A typo in a settings row must never widen what an
  // agent may do.
  return i === -1 ? 0 : i;
}

/**
 * Defaults, chosen so a workspace that never touches a setting still gets
 * something sensible and safe.
 *
 * The COO starts highest because its useful acts are reversible — moving a
 * job, reordering a day. The CFO starts at DRAFT because its useful acts are
 * not. The CEO can only ever suggest, whatever anyone sets, and that is
 * enforced by the cap below rather than by this default.
 */
export const DEFAULT_CEILINGS: Record<Officer, Rung> = {
  CEO: "SUGGEST",
  CFO: "DRAFT",
  COO: "PROPOSE",
  LEGAL: "SUGGEST",
  SALES: "DRAFT",
  EFFICIENCY: "SUGGEST",
  SYSTEM: "SUGGEST",
};

/**
 * Ceilings nobody may raise, whatever the setting says.
 *
 * The CEO proposing a strategy it then carries out is not a feature anybody
 * asked for, and an officer whose whole job is judgement should not also have
 * hands. LEGAL is capped for the same reason a lawyer advises rather than
 * signs.
 */
const HARD_CAPS: Partial<Record<Officer, Rung>> = {
  CEO: "SUGGEST",
  LEGAL: "SUGGEST",
  EFFICIENCY: "PROPOSE",
};

export async function getCeiling(tenantId: string, officer: Officer): Promise<Rung> {
  const row = await prisma.officerAutonomy.findFirst({
    where: { tenantId, officer },
    select: { ceiling: true },
  });
  return resolveCeiling(officer, row?.ceiling);
}

/** Every officer's ceiling in one read, for code that asks about all of them at once. */
export async function getCeilings(tenantId: string): Promise<(officer: Officer) => Rung> {
  const rows = await prisma.officerAutonomy.findMany({
    where: { tenantId },
    select: { officer: true, ceiling: true },
  });
  // One row per officer at most (unique on tenant and officer).
  const stored = new Map(rows.map((r) => [r.officer, r.ceiling]));
  return (officer) => resolveCeiling(officer, stored.get(officer));
}

function resolveCeiling(officer: Officer, stored: string | undefined): Rung {
  const chosen: Rung = stored !== undefined ? (RUNGS[rungIndex(stored)] ?? "OBSERVE") : DEFAULT_CEILINGS[officer];
  const cap = HARD_CAPS[officer];
  if (!cap) return chosen;

  return rungIndex(chosen) > rungIndex(cap) ? cap : chosen;
}

/** Whether a ceiling reaches a rung — may() for a ceiling already read. */
export function reaches(ceiling: Rung, rung: Rung): boolean {
  return rungIndex(rung) <= rungIndex(ceiling);
}

export async function setCeiling(params: {
  tenantId: string;
  officer: Officer;
  ceiling: Rung;
}): Promise<Rung> {
  if (!RUNGS.includes(params.ceiling)) throw new Error("No such autonomy level.");

  const cap = HARD_CAPS[params.officer];
  if (cap && rungIndex(params.ceiling) > rungIndex(cap)) {
    throw new Error(
      `${params.officer} cannot go above ${cap.toLowerCase()} — that limit is deliberate.`
    );
  }

  const existing = await prisma.officerAutonomy.findFirst({
    where: { tenantId: params.tenantId, officer: params.officer },
    select: { id: true },
  });

  if (existing) {
    await prisma.officerAutonomy.update({
      where: { id: existing.id },
      data: { ceiling: params.ceiling },
    });
  } else {
    await prisma.officerAutonomy.create({
      data: { tenantId: params.tenantId, officer: params.officer, ceiling: params.ceiling },
    });
  }
  return params.ceiling;
}

/** May this officer reach this rung in this workspace? */
export async function may(
  tenantId: string,
  officer: Officer,
  rung: Rung
): Promise<boolean> {
  const ceiling = await getCeiling(tenantId, officer);
  return rungIndex(rung) <= rungIndex(ceiling);
}

export class RungRefusedError extends Error {
  constructor(officer: Officer, wanted: Rung, ceiling: Rung) {
    super(
      `The ${officer} may only ${ceiling.toLowerCase()} in this workspace, and this needs ${wanted.toLowerCase()}. ` +
        `Raise it in settings if that is what you want.`
    );
    this.name = "RungRefusedError";
  }
}

/**
 * Throws unless the officer may reach this rung.
 *
 * Called at the point of action, not at the point of intent, so there is no
 * path around it — including for a model that has decided it knows better.
 */
export async function assertMay(
  tenantId: string,
  officer: Officer,
  rung: Rung
): Promise<void> {
  const ceiling = await getCeiling(tenantId, officer);
  if (rungIndex(rung) > rungIndex(ceiling)) {
    throw new RungRefusedError(officer, rung, ceiling);
  }
}

export interface OfficerSetting {
  officer: Officer;
  ceiling: Rung;
  label: string;
  /** The highest anybody may set this one to. */
  maxAllowed: Rung;
  capped: boolean;
}

export async function listCeilings(tenantId: string): Promise<OfficerSetting[]> {
  const officers = Object.keys(DEFAULT_CEILINGS) as Officer[];
  const ceilingOf = await getCeilings(tenantId);
  return officers.map((officer) => {
    const ceiling = ceilingOf(officer);
    const cap = HARD_CAPS[officer] ?? "ACT";
    return {
      officer,
      ceiling,
      label: RUNG_LABELS[ceiling],
      maxAllowed: cap,
      capped: cap !== "ACT",
    };
  });
}
