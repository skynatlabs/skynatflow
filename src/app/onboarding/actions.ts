"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { NicheSkin } from "@prisma/client";
import { auth } from "@/auth";
import { createProduct } from "@/lib/core/catalog";
import { createParty } from "@/lib/core/parties";
import { PartyRole } from "@prisma/client";
import { createPdfTemplate } from "@/lib/core/pdfTemplates";

export async function createTenantAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const name = String(formData.get("businessName") ?? "").trim();
  const niche = String(formData.get("niche") ?? "") as NicheSkin;
  const ownerPhone = String(formData.get("ownerPhone") ?? "").trim();

  if (!name || !niche) {
    throw new Error("Business name and niche are required.");
  }

  const tenant = await prisma.tenant.create({ data: { name, niche } });

  if (ownerPhone) {
    await prisma.user.update({ where: { id: session.user.id }, data: { phone: ownerPhone } });
  }

  // The signed-in user is the owner — no more trusting an email typed into
  // the form itself, which is what let anyone claim ownership of a
  // workspace before real auth existed.
  await prisma.membership.create({
    data: { userId: session.user.id, tenantId: tenant.id, role: "OWNER" },
  });

  // Catalog items suggested by either onboarding prefill path — the
  // website one never knows a real price (lands as a 0-price draft, owner
  // sets it on their first quote); the PDF-quote path usually does know a
  // real price straight off the document, so it's honored when present.
  const catalogItemsJson = String(formData.get("catalogItemsJson") ?? "");
  if (catalogItemsJson) {
    try {
      const items: { name: string; unitPriceCents?: number | null }[] = JSON.parse(catalogItemsJson);
      for (const item of items.slice(0, 20)) {
        if (item.name) {
          await createProduct({
            tenantId: tenant.id,
            name: item.name,
            unitPriceCents: item.unitPriceCents ?? 0,
          });
        }
      }
    } catch {
      // Malformed hint — not worth failing onboarding over.
    }
  }

  // A customer named on an uploaded PDF quote — created alongside the
  // business itself, same "extract customers and products from the same
  // import" pattern Zoho uses, just sourced from a document instead of a CSV.
  const customerJson = String(formData.get("customerJson") ?? "");
  if (customerJson) {
    try {
      const customer: { name?: string; email?: string | null; phone?: string | null } = JSON.parse(customerJson);
      if (customer.name) {
        await createParty({
          tenantId: tenant.id,
          role: niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER,
          name: customer.name,
          email: customer.email || undefined,
          phone: customer.phone || undefined,
        });
      }
    } catch {
      // Malformed hint — not worth failing onboarding over.
    }
  }

  // A logo found on their website during prefill — used to pre-brand their
  // very first PDF template so "Brand your quotes & invoices" on the next
  // screen already shows a checkmark instead of an empty picker.
  const logoDataUrl = String(formData.get("logoDataUrl") ?? "").trim();
  if (logoDataUrl) {
    try {
      await createPdfTemplate({
        tenantId: tenant.id,
        name: "Default",
        styleKey: "minimal-mono",
        logoDataUrl,
        isDefault: true,
      });
    } catch {
      // Not worth failing onboarding over — the finish step still lets
      // them pick a template manually if this didn't take.
    }
  }

  redirect(`/onboarding/finish/${tenant.id}`);
}
