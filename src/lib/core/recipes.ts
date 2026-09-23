// What a plate costs, and what the kitchen actually used.
//
// Food businesses lose margin in a way that is almost impossible to see from
// the accounts: the menu price is right, the supplier invoices are right, and
// somewhere between the two a portion and a half goes out for every portion
// sold. It never appears as a line anywhere. It appears as a gross margin
// that is four points lower than the spreadsheet said it would be, every
// month, for years.
//
// A recipe closes that gap by making consumption a number rather than an
// assumption. Selling a dish takes its ingredients off the shelf, the shelf
// is counted, and the difference between the two is the loss — which the
// existing stocktake variance report already surfaces, so nothing new has to
// be invented to read it.
//
// THE FRACTION PROBLEM, and why there is a carry table.
//
// Stock is held in whole units and a plate uses a fifth of an onion. Round
// up and the kitchen appears to burn five times what it does; round down and
// consumption silently never happens at all. So every component quantity is
// stored in THOUSANDTHS of that component's own stock unit, the unconsumed
// remainder is kept per ingredient, and stock only moves when a whole unit
// has genuinely been used. Over a week it is exact.
//
// Integers rather than decimals throughout, for the same reason money is
// cents here: a float that drifts by a gram a plate is a kilogram a week,
// and a kilogram a week is invisible forever.

import { prisma } from "@/lib/db";

/** A component may itself be a dish with a recipe — a sauce inside a burger. */
const MAX_NESTING = 3;

export interface ComponentInput {
  componentItemId: string;
  /** Thousandths of the component's stock unit. 200g of a kg item is 200. */
  quantityThousandths: number;
}

export interface RecipeInput {
  tenantId: string;
  dishItemId: string;
  yieldQty?: number;
  note?: string | null;
  isActive?: boolean;
  components: ComponentInput[];
}

/**
 * Write a recipe, replacing whatever was there.
 *
 * Replace rather than merge: a recipe is a statement of what the dish is
 * now, and a merge would quietly keep an ingredient somebody removed.
 */
export async function saveRecipe(input: RecipeInput) {
  const { tenantId, dishItemId } = input;

  const ids = [dishItemId, ...input.components.map((c) => c.componentItemId)];
  const items = await prisma.item.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true },
    take: 200,
  });
  const known = new Set(items.map((i) => i.id));
  if (!known.has(dishItemId)) throw new Error("That dish is not in this workspace's catalogue.");

  for (const component of input.components) {
    if (!known.has(component.componentItemId)) {
      throw new Error("One of those ingredients is not in this workspace's catalogue.");
    }
    if (component.componentItemId === dishItemId) {
      throw new Error("A dish cannot be an ingredient of itself.");
    }
    if (component.quantityThousandths <= 0) {
      throw new Error("An ingredient has to be used in some amount.");
    }
  }

  // Two lines for the same ingredient is almost always a mistake, and the
  // one time it is not, adding them together is what was meant.
  const merged = new Map<string, number>();
  for (const c of input.components) {
    merged.set(
      c.componentItemId,
      (merged.get(c.componentItemId) ?? 0) + Math.round(c.quantityThousandths)
    );
  }

  const yieldQty = Math.max(1, Math.round(input.yieldQty ?? 1));

  return prisma.$transaction(async (tx) => {
    const recipe = await tx.recipe.upsert({
      where: { dishItemId },
      create: {
        tenantId,
        dishItemId,
        yieldQty,
        note: input.note ?? null,
        isActive: input.isActive ?? true,
      },
      update: {
        yieldQty,
        note: input.note ?? null,
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });

    await tx.recipeComponent.deleteMany({ where: { recipeId: recipe.id } });
    if (merged.size > 0) {
      await tx.recipeComponent.createMany({
        data: [...merged.entries()].map(([componentItemId, quantityThousandths]) => ({
          tenantId,
          recipeId: recipe.id,
          componentItemId,
          quantityThousandths,
        })),
      });
    }

    return recipe;
  });
}

export async function getRecipe(tenantId: string, dishItemId: string) {
  const recipe = await prisma.recipe.findFirst({
    where: { tenantId, dishItemId },
    include: {
      dishItem: { select: { id: true, name: true, unitPriceCents: true } },
      components: {
        include: { componentItem: { select: { id: true, name: true, costCents: true, unit: true } } },
      },
    },
  });
  return recipe;
}

export async function listRecipes(tenantId: string) {
  return prisma.recipe.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: {
      dishItem: { select: { id: true, name: true, unitPriceCents: true } },
      components: { select: { quantityThousandths: true } },
    },
  });
}

export async function deleteRecipe(tenantId: string, dishItemId: string) {
  const recipe = await prisma.recipe.findFirst({
    where: { tenantId, dishItemId },
    select: { id: true },
  });
  if (!recipe) return false;
  await prisma.recipe.delete({ where: { id: recipe.id } });
  return true;
}

export interface PlateCost {
  dishItemId: string;
  dishName: string;
  sellingCents: number;
  /** What the ingredients cost, per portion. */
  costCents: number;
  marginPercent: number | null;
  /** Ingredients with no cost recorded, so the number above is a floor. */
  missingCosts: string[];
  lines: Array<{
    name: string;
    quantityThousandths: number;
    unit: string | null;
    costCents: number | null;
    lineCostCents: number;
  }>;
}

/**
 * What one portion actually costs to make.
 *
 * Reports which ingredients have no cost on them rather than treating them
 * as free. A plate cost that quietly assumes zero for the two things nobody
 * priced is the exact number this exists to replace.
 */
export async function plateCost(tenantId: string, dishItemId: string): Promise<PlateCost | null> {
  const recipe = await getRecipe(tenantId, dishItemId);
  if (!recipe) return null;

  const missingCosts: string[] = [];
  let costCents = 0;

  const lines = recipe.components.map((c) => {
    const unitCost = c.componentItem.costCents;
    if (unitCost === null) missingCosts.push(c.componentItem.name);
    const lineCost = Math.round(((unitCost ?? 0) * c.quantityThousandths) / 1000);
    costCents += lineCost;
    return {
      name: c.componentItem.name,
      quantityThousandths: c.quantityThousandths,
      unit: c.componentItem.unit,
      costCents: unitCost,
      lineCostCents: lineCost,
    };
  });

  const perPortion = Math.round(costCents / recipe.yieldQty);
  const selling = recipe.dishItem.unitPriceCents;

  return {
    dishItemId,
    dishName: recipe.dishItem.name,
    sellingCents: selling,
    costCents: perPortion,
    marginPercent:
      selling > 0 ? Math.round(((selling - perPortion) / selling) * 1000) / 10 : null,
    missingCosts,
    lines,
  };
}

export interface DepletionLine {
  componentItemId: string;
  name: string;
  usedThousandths: number;
  unitsTakenOffStock: number;
  carryLeftThousandths: number;
  /** Stock went negative, which means the count was wrong before this sale. */
  wentNegative: boolean;
}

export interface DepletionResult {
  applied: boolean;
  lines: DepletionLine[];
  /** Dishes on the sale that have no recipe, so nothing was depleted for them. */
  withoutRecipe: string[];
}

/**
 * Take a sale's ingredients off the shelf.
 *
 * Recurses when an ingredient is itself a dish with a recipe — a sauce
 * inside a burger — capped at three levels and refusing to revisit a dish it
 * has already expanded, so a recipe that eventually refers to itself stops
 * rather than spinning.
 *
 * Never throws. A kitchen must be able to sell food when a recipe is wrong,
 * and what went wrong is reported instead.
 */
export async function depleteForSale(params: {
  tenantId: string;
  lines: Array<{ itemId: string; quantity: number }>;
}): Promise<DepletionResult> {
  const needed = new Map<string, number>();
  const withoutRecipe: string[] = [];

  async function expand(itemId: string, quantity: number, depth: number, seen: Set<string>) {
    if (depth > MAX_NESTING || seen.has(itemId)) return;

    const recipe = await prisma.recipe.findFirst({
      where: { tenantId: params.tenantId, dishItemId: itemId, isActive: true },
      include: { components: true },
    });
    if (!recipe || recipe.components.length === 0) {
      if (depth === 0) withoutRecipe.push(itemId);
      return;
    }

    const nextSeen = new Set(seen).add(itemId);
    for (const component of recipe.components) {
      const amount = (component.quantityThousandths * quantity) / recipe.yieldQty;
      const nested = await prisma.recipe.findFirst({
        where: { tenantId: params.tenantId, dishItemId: component.componentItemId, isActive: true },
        select: { id: true },
      });
      if (nested) {
        // A sub-recipe's quantity is in thousandths of a portion of it.
        await expand(component.componentItemId, amount / 1000, depth + 1, nextSeen);
      } else {
        needed.set(
          component.componentItemId,
          (needed.get(component.componentItemId) ?? 0) + amount
        );
      }
    }
  }

  for (const line of params.lines) {
    await expand(line.itemId, line.quantity, 0, new Set());
  }

  if (needed.size === 0) return { applied: false, lines: [], withoutRecipe };

  const ids = [...needed.keys()];
  const [items, carries] = await Promise.all([
    prisma.item.findMany({
      where: { tenantId: params.tenantId, id: { in: ids } },
      select: { id: true, name: true, stockQty: true },
      take: 200,
    }),
    prisma.recipeCarry.findMany({
      where: { tenantId: params.tenantId, componentItemId: { in: ids } },
      take: 200,
    }),
  ]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const carryById = new Map(carries.map((c) => [c.componentItemId, c.carryThousandths]));
  const out: DepletionLine[] = [];

  for (const [componentItemId, usedRaw] of needed) {
    const item = itemById.get(componentItemId);
    if (!item) continue;

    const used = Math.round(usedRaw);
    const total = (carryById.get(componentItemId) ?? 0) + used;
    const wholeUnits = Math.floor(total / 1000);
    const carryLeft = total - wholeUnits * 1000;

    await prisma.recipeCarry.upsert({
      where: {
        tenantId_componentItemId: { tenantId: params.tenantId, componentItemId },
      },
      create: { tenantId: params.tenantId, componentItemId, carryThousandths: carryLeft },
      update: { carryThousandths: carryLeft },
    });

    let wentNegative = false;
    if (wholeUnits > 0 && item.stockQty !== null) {
      const after = item.stockQty - wholeUnits;
      wentNegative = after < 0;
      await prisma.item.update({
        where: { id: componentItemId },
        data: { stockQty: after },
      });
    }

    out.push({
      componentItemId,
      name: item.name,
      usedThousandths: used,
      unitsTakenOffStock: item.stockQty === null ? 0 : wholeUnits,
      carryLeftThousandths: carryLeft,
      wentNegative,
    });
  }

  return { applied: true, lines: out, withoutRecipe };
}

export interface MenuMarginRow {
  dishItemId: string;
  dishName: string;
  sellingCents: number;
  costCents: number;
  marginPercent: number | null;
  missingCosts: number;
}

/**
 * The menu, ranked by the margin that is actually being earned.
 *
 * Worst first. A menu sorted by name hides the two dishes that lose money
 * among the thirty that do not, which is the same failure the margins page
 * exists to fix one level up.
 */
export async function menuMargins(tenantId: string): Promise<MenuMarginRow[]> {
  const recipes = await listRecipes(tenantId);
  const rows: MenuMarginRow[] = [];

  for (const recipe of recipes) {
    const cost = await plateCost(tenantId, recipe.dishItemId);
    if (!cost) continue;
    rows.push({
      dishItemId: cost.dishItemId,
      dishName: cost.dishName,
      sellingCents: cost.sellingCents,
      costCents: cost.costCents,
      marginPercent: cost.marginPercent,
      missingCosts: cost.missingCosts.length,
    });
  }

  return rows.sort((a, b) => (a.marginPercent ?? 999) - (b.marginPercent ?? 999));
}
