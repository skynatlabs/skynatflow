// The niche-config layer — this is what "one engine, many skins" means in
// code (strategic report, Section 5). Every vertical shares the exact same
// Party/Item/Transaction/Event tables; what changes per niche is only
// vocabulary and the pipeline stages shown in the UI. Nothing here changes
// the data model or the Business Graph API.

import { NicheSkin } from "@prisma/client";

export interface PipelineStage {
  key: string;
  label: string;
}

export interface NicheConfig {
  skin: NicheSkin;
  label: string;
  tagline: string;
  // What a "Party" with role CUSTOMER is called in this niche's UI.
  customerLabel: string;
  // What an accepted-quote-to-payment journey is called, stage by stage —
  // purely a UI/vocabulary concern, all backed by the same Transaction rows.
  pipeline: PipelineStage[];
  // Which core capabilities are emphasized in this niche's dashboard.
  emphasizes: Array<"quoting" | "inventory" | "delivery" | "wholesale" | "appointments" | "subscriptions">;
}

export const NICHE_CONFIGS: Record<NicheSkin, NicheConfig> = {
  CORPORATE: {
    skin: "CORPORATE",
    label: "Corporate / Company Management",
    tagline: "Customers, deals, and cash flow in one place.",
    customerLabel: "Client",
    pipeline: [
      { key: "lead", label: "Lead" },
      { key: "quoted", label: "Quoted" },
      { key: "won", label: "Won" },
      { key: "invoiced", label: "Invoiced" },
      { key: "paid", label: "Paid" },
    ],
    emphasizes: ["quoting"],
  },
  SERVICES: {
    skin: "SERVICES",
    label: "Services (e.g. Solar, Contractors)",
    tagline: "Quote to cash, with nothing falling through the cracks.",
    customerLabel: "Customer",
    pipeline: [
      { key: "lead", label: "Lead" },
      { key: "site_visit", label: "Site Visit" },
      { key: "quoted", label: "Quoted" },
      { key: "deposit", label: "Deposit Paid" },
      { key: "installed", label: "Installed" },
      { key: "paid", label: "Paid in Full" },
    ],
    emphasizes: ["quoting", "delivery"],
  },
  LOGISTICS: {
    skin: "LOGISTICS",
    label: "Logistics & Delivery",
    tagline: "Paperless proof of delivery, built in.",
    customerLabel: "Consignee",
    pipeline: [
      { key: "booked", label: "Booked" },
      { key: "collected", label: "Collected" },
      { key: "in_transit", label: "In Transit" },
      { key: "delivered", label: "Delivered" },
      { key: "invoiced", label: "Invoiced" },
    ],
    emphasizes: ["delivery"],
  },
  MEDICAL: {
    skin: "MEDICAL",
    label: "Medical / Patient Management",
    tagline: "Appointments, billing, and follow-up — no clinical data stored.",
    customerLabel: "Patient",
    pipeline: [
      { key: "booked", label: "Appointment Booked" },
      { key: "seen", label: "Seen" },
      { key: "invoiced", label: "Invoiced" },
      { key: "paid", label: "Paid" },
    ],
    emphasizes: ["appointments"],
  },
  RETAIL: {
    skin: "RETAIL",
    label: "Retail",
    tagline: "Stock, till, and branch reporting in sync.",
    customerLabel: "Customer",
    pipeline: [
      { key: "sale", label: "Sale" },
      { key: "paid", label: "Paid" },
    ],
    emphasizes: ["inventory"],
  },
  WHOLESALE: {
    skin: "WHOLESALE",
    label: "Wholesale Distribution",
    tagline: "Tiered pricing and retailer self-ordering.",
    customerLabel: "Account",
    pipeline: [
      { key: "quoted", label: "Quoted" },
      { key: "ordered", label: "Ordered" },
      { key: "shipped", label: "Shipped" },
      { key: "invoiced", label: "Invoiced" },
      { key: "paid", label: "Paid" },
    ],
    emphasizes: ["wholesale", "inventory"],
  },
  ECOMMERCE: {
    skin: "ECOMMERCE",
    label: "E-commerce",
    tagline: "Orders, fulfillment, and follow-up in one flow.",
    customerLabel: "Shopper",
    pipeline: [
      { key: "ordered", label: "Ordered" },
      { key: "paid", label: "Paid" },
      { key: "fulfilled", label: "Fulfilled" },
    ],
    emphasizes: ["inventory", "subscriptions"],
  },
};

export function nicheConfig(skin: NicheSkin): NicheConfig {
  return NICHE_CONFIGS[skin];
}
