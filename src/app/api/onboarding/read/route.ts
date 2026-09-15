// Everything handed over while setting up comes through here: documents,
// photographs, spreadsheets, a website address, or a sentence typed into the
// box. What comes back is a proposal to confirm — nothing is written yet.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireTenantAccess, AuthRequiredError, ForbiddenError } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { readIntakeFiles, readSpokenText, type IntakeFile } from "@/lib/onboarding/intake";
import { prefillFromUrl } from "@/lib/onboarding/prefill";
import { emptyProposal, mergeProposals, type Proposal } from "@/lib/onboarding/proposal";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

/** The website path: the business name, its trade, a logo and a few products. */
async function fromWebsite(rawUrl: string): Promise<Proposal> {
  const p = emptyProposal();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    p.problems.push("That does not look like a web address.");
    return p;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    p.problems.push("That does not look like a web address.");
    return p;
  }

  const prefill = await prefillFromUrl(url.toString());
  const source = url.hostname.replace(/^www\./, "");
  if (!prefill) {
    p.problems.push(`${source}: the site could not be reached.`);
    return p;
  }

  p.documents.push({ fileName: source, kind: "website", summary: prefill.businessName ? `Read ${prefill.businessName}'s site.` : "Read the site.", confidence: null, notes: null });
  if (prefill.businessName) p.business.name = { value: prefill.businessName, source };
  if (prefill.suggestedNiche) p.suggestedNiche = { value: prefill.suggestedNiche, source };
  p.business.website = { value: url.toString(), source };
  p.products = prefill.suggestedCatalogItems.slice(0, 20).map((item, i) => ({
    key: `${source}:p${i}`,
    name: item.name,
    sku: null,
    unit: null,
    // A website names what a business sells; it rarely states the real price,
    // and a made-up one is worse than a blank to fill in on the first quote.
    unitPriceCents: null,
    costCents: null,
    quantityOnHand: null,
    taxRatePercent: null,
    category: null,
    source,
  }));

  if (prefill.logoUrl) {
    try {
      const res = await fetch(prefill.logoUrl, { signal: AbortSignal.timeout(5000) });
      const contentType = res.headers.get("content-type") ?? "";
      if (res.ok && contentType.startsWith("image/")) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 2 * 1024 * 1024) {
          p.logoDataUrl = { value: `data:${contentType};base64,${buffer.toString("base64")}`, source };
        }
      }
    } catch {
      // A logo that will not load is never worth failing the rest over.
    }
  }
  return p;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const form = await req.formData();
  const tenantId = String(form.get("tenantId") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  const said = String(form.get("text") ?? "").trim();

  // A workspace that exists is checked; before there is one, this is only
  // reading files the person just chose, for themselves.
  let context: { businessName?: string | null; countryCode?: string | null } = {};
  if (tenantId) {
    try {
      await requireTenantAccess(tenantId);
    } catch (err) {
      if (err instanceof AuthRequiredError) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      if (err instanceof ForbiddenError) return NextResponse.json({ error: "Not your workspace" }, { status: 404 });
      throw err;
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, countryCode: true } });
    context = { businessName: tenant?.name, countryCode: tenant?.countryCode };
  }

  const uploaded = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploaded.length > MAX_FILES) {
    return NextResponse.json({ error: `That is a lot at once — ${MAX_FILES} files at a time.` }, { status: 400 });
  }
  let total = 0;
  const files: IntakeFile[] = [];
  for (const f of uploaded) {
    total += f.size;
    if (f.size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: `${f.name} is too large. Photographs are fine; a file over 12MB is not.` }, { status: 400 });
    }
    files.push({ name: f.name, mediaType: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()) });
  }

  if (files.length === 0 && !url && !said) {
    return NextResponse.json({ error: "Nothing to read." }, { status: 400 });
  }

  const parts = await Promise.all([
    files.length ? readIntakeFiles(files, context) : Promise.resolve(emptyProposal()),
    url ? fromWebsite(url) : Promise.resolve(emptyProposal()),
    said ? readSpokenText(said, context) : Promise.resolve(emptyProposal()),
  ]);
  const proposal = mergeProposals(...parts);

  // Kept so every field can say which document it came from, and so a second
  // pass through the same paperwork is recognisable as one.
  if (tenantId && proposal.documents.length > 0) {
    await prisma.intakeDocument.createMany({
      data: proposal.documents.map((d) => ({
        tenantId,
        fileName: d.fileName,
        mediaType: files.find((f) => f.name === d.fileName)?.mediaType ?? (d.kind === "website" ? "text/html" : "text/plain"),
        kind: d.kind,
        summary: d.summary,
        reading: JSON.parse(JSON.stringify({ confidence: d.confidence, notes: d.notes })),
      })),
    });
  }

  return NextResponse.json({ proposal });
}
