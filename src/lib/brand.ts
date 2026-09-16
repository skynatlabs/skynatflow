// The product's name, in one place. The rename from flow to skynat.ai is a
// positioning change as much as a word: a suite of officers, not a tool.
export const BRAND = "skynat.ai";
export const BRAND_TAGLINE = "Six executives for your business";

/**
 * What the operator's own dashboards report in.
 *
 * The platform screens under /car aggregate across every workspace, so there
 * is no one business whose currency to use. Totalling dollars and rands into
 * a single figure is wrong whichever symbol goes in front of it, and the
 * honest fix is to say which currency the total is expressed in and let the
 * deployment choose it — rather than hardcoding the founder's own.
 *
 * Converting each workspace's figures at a live rate before totalling is the
 * right long-term answer; until there is a rate source, this is labelled as
 * an unconverted sum, which is what it is.
 */
export const PLATFORM_CURRENCY = process.env.PLATFORM_CURRENCY ?? "USD";

export const PLATFORM_TOTAL_CAVEAT =
  "Workspaces trade in their own currencies and these totals are not converted, so treat them as a scale indicator rather than a financial figure.";
