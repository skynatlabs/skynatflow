// The certificate the job produces.
//
// In several trades the work is not finished when the work is finished — it
// is finished when the certificate exists. A certificate of compliance, a
// pressure test report, a service record: the customer cannot sell the house,
// claim on insurance or pass an inspection without it, and the business
// cannot invoice with a clear conscience.
//
// Two things make this worth having rather than a Word template:
//
//   IT IS ISSUED FROM THE JOB. The readings, the date and the person come off
//   the work that was actually done. A certificate written from memory a week
//   later is the one that is wrong, and it is wrong in a way that is somebody
//   else's problem for years.
//
//   IT EXPIRES. Most of these are valid for a period, and the business that
//   issued it is the one best placed to say so — which is a service due, a
//   renewal to sell, and a customer who does not find out from an inspector.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface CertificateSection {
  heading: string;
  body: string;
}

export interface CertificateTemplate {
  kind: string;
  label: string;
  /** What it is for, in the words of whoever picks it. */
  purpose: string;
  /** How long it is normally valid. Null where it does not expire. */
  validMonths: number | null;
  /** Whether the trade requires a registration number on the face of it. */
  wantsIssuerRef: boolean;
  sections: CertificateSection[];
}

export const CERTIFICATE_TEMPLATES: CertificateTemplate[] = [
  {
    kind: "coc",
    label: "Electrical certificate of compliance",
    purpose: "Required before a property changes hands, and by most insurers after electrical work.",
    validMonths: 24,
    wantsIssuerRef: true,
    sections: [
      { heading: "The installation", body: "Describe what was inspected and where — the board, the circuits, the property." },
      { heading: "Tests carried out", body: "Earth continuity, insulation resistance, polarity, earth leakage trip time. Record the readings." },
      { heading: "Defects found and corrected", body: "What was wrong and what was done about it. Write \"none\" where there were none." },
      { heading: "Anything excluded", body: "Parts of the installation not covered by this certificate. The clause that prevents the argument." },
      { heading: "Declaration", body: "The installation described above complies with the applicable standard at the date of this certificate." },
    ],
  },
  {
    kind: "plumbing-coc",
    label: "Plumbing certificate of compliance",
    purpose: "Required by many municipalities on transfer, and after geyser or water-main work.",
    validMonths: 24,
    wantsIssuerRef: true,
    sections: [
      { heading: "The installation", body: "What was inspected and where." },
      { heading: "Tests carried out", body: "Pressure test and duration held, temperature and pressure valve, overflow discharge." },
      { heading: "Defects found and corrected", body: "What was wrong and what was done about it." },
      { heading: "Declaration", body: "The installation described above complies with the applicable standard at the date of this certificate." },
    ],
  },
  {
    kind: "test-report",
    label: "Test report",
    purpose: "The readings, on paper, where no formal certificate applies but the numbers matter.",
    validMonths: null,
    wantsIssuerRef: false,
    sections: [
      { heading: "What was tested", body: "" },
      { heading: "Method", body: "" },
      { heading: "Readings", body: "" },
      { heading: "Conclusion", body: "" },
    ],
  },
  {
    kind: "service-record",
    label: "Service record",
    purpose: "What was serviced, what was replaced, and when the next one is due.",
    validMonths: 12,
    wantsIssuerRef: false,
    sections: [
      { heading: "What was serviced", body: "" },
      { heading: "Work done", body: "" },
      { heading: "Parts replaced", body: "" },
      { heading: "Next service", body: "" },
    ],
  },
];

export const TEMPLATE_BY_KIND: Record<string, CertificateTemplate> = Object.fromEntries(
  CERTIFICATE_TEMPLATES.map((t) => [t.kind, t])
);

export async function nextCertificateNumber(tenantId: string): Promise<string> {
  const last = await prisma.certificate.findFirst({
    where: { tenantId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last ? Number(last.number.replace(/\D/g, "")) + 1 : 1;
  return `CERT-${String(n).padStart(4, "0")}`;
}

function parseSections(raw: Prisma.JsonValue | null | undefined): CertificateSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const s = entry as Record<string, unknown>;
    if (typeof s.heading !== "string" || typeof s.body !== "string") return [];
    return [{ heading: s.heading, body: s.body }];
  });
}

export async function issueCertificate(params: {
  tenantId: string;
  kind: string;
  jobCardId?: string | null;
  partyId?: string | null;
  title?: string;
  sections?: CertificateSection[];
  issuedOn?: Date;
  issuedBy?: string | null;
  issuerRef?: string | null;
  signatureDataUrl?: string | null;
}) {
  const template = TEMPLATE_BY_KIND[params.kind];
  if (!template) throw new Error("There is no such kind of certificate.");

  // Where it came from a job, the job decides the customer — a certificate
  // issued against one job and addressed to another customer is the single
  // worst thing this feature could produce.
  let partyId = params.partyId ?? null;
  if (params.jobCardId) {
    const job = await prisma.jobCard.findFirst({
      where: { id: params.jobCardId, tenantId: params.tenantId },
      select: { id: true, partyId: true },
    });
    if (!job) throw new Error("That job is not in this workspace.");
    partyId = job.partyId;
  } else if (partyId) {
    const party = await prisma.party.findFirst({ where: { id: partyId, tenantId: params.tenantId }, select: { id: true } });
    if (!party) throw new Error("That customer is not in this workspace.");
  }

  if (template.wantsIssuerRef && !params.issuerRef?.trim()) {
    throw new Error(`A ${template.label.toLowerCase()} has to carry the issuer's registration number.`);
  }

  const issuedOn = params.issuedOn ?? new Date();
  const expiresOn = template.validMonths
    ? new Date(new Date(issuedOn).setMonth(issuedOn.getMonth() + template.validMonths))
    : null;

  return prisma.certificate.create({
    data: {
      tenantId: params.tenantId,
      kind: template.kind,
      number: await nextCertificateNumber(params.tenantId),
      title: params.title?.trim() || template.label,
      body: (params.sections ?? template.sections) as unknown as Prisma.InputJsonValue,
      jobCardId: params.jobCardId ?? null,
      partyId,
      issuedOn,
      expiresOn,
      issuedBy: params.issuedBy?.trim() || null,
      issuerRef: params.issuerRef?.trim() || null,
      signatureDataUrl: params.signatureDataUrl ?? null,
    },
  });
}

export async function getCertificate(tenantId: string, certificateId: string) {
  const cert = await prisma.certificate.findFirst({
    where: { id: certificateId, tenantId },
    include: { party: true, jobCard: { select: { id: true, title: true } } },
  });
  if (!cert) return null;
  return { ...cert, sections: parseSections(cert.body) };
}

export async function listCertificates(tenantId: string, opts: { partyId?: string; kind?: string } = {}) {
  return prisma.certificate.findMany({
    where: { tenantId, ...(opts.partyId ? { partyId: opts.partyId } : {}), ...(opts.kind ? { kind: opts.kind } : {}) },
    orderBy: { issuedOn: "desc" },
    take: 200,
    include: { party: { select: { id: true, name: true, companyName: true } } },
  });
}

/**
 * Certificates coming up for renewal.
 *
 * The business that issued it is the one best placed to say so, which makes
 * this both a service to the customer and next month's work — and it is the
 * difference between a customer who renews and one who finds out from an
 * inspector.
 */
export async function expiringCertificates(tenantId: string, withinDays = 90, now = new Date()) {
  const cutoff = new Date(now.getTime() + withinDays * 86_400_000);
  const rows = await prisma.certificate.findMany({
    where: { tenantId, expiresOn: { not: null, lte: cutoff } },
    orderBy: { expiresOn: "asc" },
    take: 200,
    include: { party: { select: { id: true, name: true, companyName: true, phone: true, email: true } } },
  });

  return rows.map((c) => {
    const days = Math.floor((c.expiresOn!.getTime() - now.getTime()) / 86_400_000);
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      kind: c.kind,
      customer: c.party ? c.party.companyName ?? c.party.name : null,
      partyId: c.partyId,
      phone: c.party?.phone ?? null,
      expiresOn: c.expiresOn!,
      daysLeft: days,
      expired: days < 0,
    };
  });
}

export async function certificateHealth(tenantId: string, now = new Date()) {
  const [total, expiring] = await Promise.all([
    prisma.certificate.count({ where: { tenantId } }),
    expiringCertificates(tenantId, 90, now),
  ]);
  const expired = expiring.filter((c) => c.expired).length;
  const soon = expiring.length - expired;

  return {
    issued: total,
    expired,
    expiringWithin90Days: soon,
    summary:
      total === 0
        ? "No certificates issued yet."
        : `${total} issued` +
          (expired > 0 ? `, ${expired} already expired` : "") +
          (soon > 0 ? `, ${soon} due within three months — each one is a renewal worth selling.` : "."),
    rows: expiring.slice(0, 50),
  };
}
