// Seeds one demo tenant per vertical, each with a worked example, so all
// seven niches can be compared side by side from day one — per the
// "we don't know which industry will perform best" instruction.

// Must load before any module (transitively src/lib/db.ts) reads
// process.env.DATABASE_URL — tsx does not auto-load .env the way Next.js
// dev/build does, so without this the db client silently falls back to an
// empty connection string.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PartyRole, NicheSkin } from "@prisma/client";
import {
  createQuote,
  sendQuote,
  recordResponse,
  convertToInvoice,
  recordPayment,
} from "../src/lib/core/money";
import { prisma } from "../src/lib/db";

interface DemoSpec {
  niche: NicheSkin;
  businessName: string;
  customerRole: PartyRole;
  customerName: string;
  customerPhone: string;
  itemName: string;
  priceCents: number;
}

const DEMOS: DemoSpec[] = [
  {
    niche: "CORPORATE",
    businessName: "Demo Corporate Services",
    customerRole: "CUSTOMER",
    customerName: "Acme Client Ltd",
    customerPhone: "+27821000001",
    itemName: "Quarterly consulting retainer",
    priceCents: 4500000,
  },
  {
    niche: "SERVICES",
    businessName: "Demo Solar Co",
    customerRole: "CUSTOMER",
    customerName: "Jane Homeowner",
    customerPhone: "+27821234567",
    itemName: "5kW Solar Install",
    priceCents: 8500000,
  },
  {
    niche: "LOGISTICS",
    businessName: "Demo Fleet Logistics",
    customerRole: "CUSTOMER",
    customerName: "Retail Distribution Co",
    customerPhone: "+27821000002",
    itemName: "Weekly delivery route",
    priceCents: 1250000,
  },
  {
    niche: "MEDICAL",
    businessName: "Demo Family Practice",
    customerRole: "PATIENT",
    customerName: "Thabo M.",
    customerPhone: "+27821000003",
    itemName: "General consultation",
    priceCents: 65000,
  },
  {
    niche: "RETAIL",
    businessName: "Demo Corner Store",
    customerRole: "CUSTOMER",
    customerName: "Walk-in Customer",
    customerPhone: "+27821000004",
    itemName: "Weekly grocery order",
    priceCents: 85000,
  },
  {
    niche: "WHOLESALE",
    businessName: "Demo Bulk Supplies",
    customerRole: "CUSTOMER",
    customerName: "Corner Store Buyer",
    customerPhone: "+27821000005",
    itemName: "Pallet of dry goods",
    priceCents: 1800000,
  },
  {
    niche: "ECOMMERCE",
    businessName: "Demo Online Store",
    customerRole: "CUSTOMER",
    customerName: "Online Shopper",
    customerPhone: "+27821000006",
    itemName: "Order #1042",
    priceCents: 45000,
  },
];

const DEMO_PASSWORD = "demopass123";

async function seedDemo(spec: DemoSpec, passwordHash: string) {
  const tenant = await prisma.tenant.create({
    data: { name: spec.businessName, niche: spec.niche },
  });

  const owner = await prisma.user.create({
    data: {
      email: `owner@${spec.niche.toLowerCase()}.demo.local`,
      name: "Demo Owner",
      phone: "+27831112222",
      passwordHash,
    },
  });
  await prisma.membership.create({
    data: { userId: owner.id, tenantId: tenant.id, role: "OWNER" },
  });

  const customer = await prisma.party.create({
    data: {
      tenantId: tenant.id,
      role: spec.customerRole,
      name: spec.customerName,
      phone: spec.customerPhone,
    },
  });

  const item = await prisma.item.create({
    data: { tenantId: tenant.id, name: spec.itemName, unitPriceCents: spec.priceCents },
  });

  const quote = await createQuote({
    tenantId: tenant.id,
    partyId: customer.id,
    lines: [{ itemId: item.id, quantity: 1, unitPriceCents: spec.priceCents }],
  });
  await sendQuote(quote.id);
  await recordResponse(quote.id, "ACCEPTED");
  const invoice = await convertToInvoice({ quoteId: quote.id });
  await recordPayment({ invoiceId: invoice.id, amountCents: Math.round(spec.priceCents * 0.2) });

  console.log(`Seeded ${spec.niche} tenant ${tenant.id} (${spec.businessName})`);
  return tenant;
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const tenants = [];
  for (const spec of DEMOS) {
    tenants.push(await seedDemo(spec, passwordHash));
  }

  // A platform-operator account with visibility into every seeded
  // workspace — the "super user across multiple businesses" role.
  const superAdmin = await prisma.user.create({
    data: {
      email: "admin@platform.demo.local",
      name: "Platform Admin",
      isSuperAdmin: true,
      passwordHash,
    },
  });
  await prisma.membership.createMany({
    data: tenants.map((t) => ({ userId: superAdmin.id, tenantId: t.id, role: "OWNER" })),
  });

  console.log(`\nSeeded ${DEMOS.length} demo workspaces — one per vertical.`);
  console.log(`Super admin: ${superAdmin.email} (member of all ${tenants.length} workspaces)`);
  console.log(`All demo accounts (including per-niche owners) share password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
