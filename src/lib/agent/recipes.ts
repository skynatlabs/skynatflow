// Agents somebody else already wrote.
//
// A marketplace with no code in it. A recipe is a name, a brief, a schedule
// and the tools it may use — nothing executable, nothing that can reach
// outside the installing workspace. Installing one is a configuration choice
// rather than a security decision, because everything the resulting agent can
// do is already bounded by that workspace's own roles and autonomy setting.
//
// The tool list narrows and never widens: a recipe asking for a tool the
// installing role does not have simply does not get it, and the install says
// so rather than failing. A recipe that could grant capability would be a
// privilege escalation dressed as a template.

import { prisma } from "@/lib/db";
import { agentToolNames } from "@/lib/agent/tools";
import type { Role } from "@/lib/core/access";

export interface RecipeInput {
  slug: string;
  name: string;
  summary: string;
  brief: string;
  schedule?: string | null;
  tools: string[];
  niches?: string[];
}

/**
 * The ones that ship with the platform.
 *
 * Deliberately few and deliberately dull: the recipes worth having are the
 * jobs every business has and nobody gets round to, not clever ones.
 */
export const BUILT_IN_RECIPES: RecipeInput[] = [
  {
    slug: "debtor-chaser",
    name: "The debtor chaser",
    summary: "Looks at who is late every morning and writes the next message on the ladder.",
    brief:
      "Each morning, read who is overdue and which rung of the chasing ladder each is on. Skip anybody on a payment " +
      "plan who is up to date. For the two or three worst, draft the next message and put it in front of the owner. " +
      "Never send anything yourself.",
    schedule: "0 7 * * 1-5",
    tools: ["whoToChase", "draftTheChase", "chasingHistory", "paymentPlan", "everythingAboutThem"],
    niches: [],
  },
  {
    slug: "slip-chaser",
    name: "The slip chaser",
    summary: "Finds the costs nobody coded and asks about them while anybody still remembers.",
    brief:
      "Once a week, find costs with no account or category on them and costs with no tax recorded. Ask about the " +
      "biggest handful by name, with the supplier and the amount, so somebody can answer in one line. Apply what " +
      "this workspace has already been taught before asking.",
    schedule: "0 8 * * 1",
    tools: ["unclassifiedSpending", "howCostsAreCoded", "codeThisCost", "listExpenses"],
    niches: [],
  },
  {
    slug: "week-ahead",
    name: "The week ahead",
    summary: "Says on a Friday what next week looks like and where it is over-promised.",
    brief:
      "Every Friday afternoon, read the coming week's board. Say which days are over-booked, which jobs have nobody " +
      "on them, and anything held up by a checklist or waiting on another job. Keep it to five lines.",
    schedule: "0 15 * * 5",
    tools: ["theDay", "canWeFitItIn", "checklistsAndWhatIsBlocked", "jobBudgets"],
    niches: ["SERVICES", "LOGISTICS", "CORPORATE"],
  },
  {
    slug: "renewal-watch",
    name: "The renewal watch",
    summary: "Watches certificates and maintenance contracts coming up, which is next month's work.",
    brief:
      "Once a week, find certificates expiring within ninety days and maintenance agreements that have lapsed " +
      "without anybody renewing them. For each, say who the customer is and what to offer them. These are sales, " +
      "not admin.",
    schedule: "0 9 * * 2",
    tools: ["certificates", "maintenanceContracts", "everythingAboutThem", "agreements"],
    niches: ["SERVICES", "CORPORATE"],
  },
  {
    slug: "quiet-customers",
    name: "The quiet ones",
    summary: "Notices good customers who have gone quiet, before they are gone.",
    brief:
      "Once a fortnight, find customers who used to buy regularly and have not in a while. Rank them by what they " +
      "were worth. Say what they last bought and how long it has been. Suggest one thing to say to each.",
    schedule: "0 10 * * 3",
    tools: ["salesHealth", "everythingAboutThem", "customerHistory", "findCustomers"],
    niches: [],
  },
  {
    slug: "stock-watch",
    name: "The stock watch",
    summary: "Keeps the shelves from emptying, and says what is not moving.",
    brief:
      "Every Monday, read what is below its reorder point or already out, and what has not moved in months. Draft " +
      "the purchase orders for the first list and say plainly what the second is costing to hold.",
    schedule: "0 7 * * 1",
    tools: ["reorderSuggestions", "demandHeatmap", "expiryRisk", "listProducts", "listPurchaseOrders"],
    niches: ["RETAIL", "WHOLESALE", "ECOMMERCE"],
  },
];

export async function publishRecipe(params: RecipeInput & { tenantId?: string | null }) {
  if (!params.slug.trim() || !params.name.trim() || !params.brief.trim()) {
    throw new Error("A recipe needs a name, a slug and something to tell it to do.");
  }
  return prisma.agentRecipe.upsert({
    where: { slug: params.slug },
    create: {
      tenantId: params.tenantId ?? null,
      slug: params.slug,
      name: params.name,
      summary: params.summary,
      brief: params.brief,
      schedule: params.schedule ?? null,
      tools: params.tools,
      niches: params.niches ?? [],
    },
    update: {
      name: params.name,
      summary: params.summary,
      brief: params.brief,
      schedule: params.schedule ?? null,
      tools: params.tools,
      niches: params.niches ?? [],
    },
  });
}

/** Put the built-in ones in the catalogue. Idempotent; safe on every boot. */
export async function seedBuiltInRecipes() {
  for (const recipe of BUILT_IN_RECIPES) await publishRecipe(recipe);
  return BUILT_IN_RECIPES.length;
}

/** What this workspace could install, most-installed first. */
export async function availableRecipes(tenantId: string) {
  const [recipes, tenant, installed] = await Promise.all([
    prisma.agentRecipe.findMany({ orderBy: [{ installs: "desc" }, { name: "asc" }], take: 100 }),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { niche: true } }),
    prisma.agentDefinition.findMany({ where: { tenantId }, select: { name: true } }),
  ]);
  const have = new Set(installed.map((a) => a.name));

  return recipes
    .filter((r) => r.niches.length === 0 || r.niches.includes(tenant.niche))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      summary: r.summary,
      schedule: r.schedule,
      tools: r.tools.length,
      installs: r.installs,
      alreadyInstalled: have.has(r.name),
      byThisWorkspace: r.tenantId === tenantId,
    }));
}

export interface InstallResult {
  agentId: string;
  name: string;
  /** Tools the recipe asked for that this role cannot have. Said, not hidden. */
  toolsNotAvailable: string[];
  toolsGranted: number;
}

/**
 * Install one.
 *
 * The role passed in is the one the resulting agent runs as, and the tool
 * list is intersected with what that role may do. A recipe cannot widen
 * anything — it can only pick from what the workspace already permits.
 */
export async function installRecipe(params: {
  tenantId: string;
  slug: string;
  role: Role;
  createdById?: string | null;
}): Promise<InstallResult> {
  const recipe = await prisma.agentRecipe.findUnique({ where: { slug: params.slug } });
  if (!recipe) throw new Error("There is no such recipe.");

  const permitted = new Set(agentToolNames(params.role));
  const granted = recipe.tools.filter((t) => permitted.has(t));
  const refused = recipe.tools.filter((t) => !permitted.has(t));

  const existing = await prisma.agentDefinition.findFirst({
    where: { tenantId: params.tenantId, name: recipe.name },
    select: { id: true },
  });

  const agent = existing
    ? await prisma.agentDefinition.update({
        where: { id: existing.id },
        data: { brief: recipe.brief, schedule: recipe.schedule, toolNames: granted, isActive: true },
      })
    : await prisma.agentDefinition.create({
        data: {
          tenantId: params.tenantId,
          name: recipe.name,
          brief: recipe.brief,
          schedule: recipe.schedule,
          toolNames: granted,
          isActive: true,
        },
      });

  await prisma.agentRecipe.update({ where: { id: recipe.id }, data: { installs: { increment: 1 } } });

  return { agentId: agent.id, name: agent.name, toolsNotAvailable: refused, toolsGranted: granted.length };
}

/** Publish one of this workspace's own agents for others to install. */
export async function shareAgent(params: { tenantId: string; agentId: string; slug: string; summary: string; niches?: string[] }) {
  const agent = await prisma.agentDefinition.findFirst({
    where: { id: params.agentId, tenantId: params.tenantId },
  });
  if (!agent) throw new Error("That agent is not in this workspace.");

  return publishRecipe({
    tenantId: params.tenantId,
    slug: params.slug,
    name: agent.name,
    summary: params.summary,
    brief: agent.brief,
    schedule: agent.schedule,
    tools: agent.toolNames,
    niches: params.niches ?? [],
  });
}
