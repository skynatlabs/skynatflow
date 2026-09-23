// The fraction is the whole problem. A plate using a fifth of an onion must
// not round up (the kitchen appears to burn five times what it does) and must
// not round down (consumption silently never happens). So the tests that
// matter here are arithmetic: five plates take exactly one onion, and the
// remainder survives between sales.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  saveRecipe,
  getRecipe,
  listRecipes,
  deleteRecipe,
  plateCost,
  depleteForSale,
  menuMargins,
} from "../../src/lib/core/recipes";

let tenantId: string;
let burger: string;
let patty: string;
let bun: string;
let onion: string;
let sauce: string;

async function item(name: string, opts: { price?: number; cost?: number; stock?: number | null } = {}) {
  const created = await prisma.item.create({
    data: {
      tenantId,
      name,
      unitPriceCents: opts.price ?? 0,
      costCents: opts.cost ?? null,
      stockQty: opts.stock === undefined ? 100 : opts.stock,
    },
  });
  return created.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Recipe Test Kitchen", niche: "RETAIL" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.recipeComponent.deleteMany({ where: { tenantId } });
  await prisma.recipe.deleteMany({ where: { tenantId } });
  await prisma.recipeCarry.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.recipeComponent.deleteMany({ where: { tenantId } });
  await prisma.recipe.deleteMany({ where: { tenantId } });
  await prisma.recipeCarry.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });

  burger = await item("Burger", { price: 8500 });
  patty = await item("Beef patty", { cost: 2200, stock: 50 });
  bun = await item("Bun", { cost: 400, stock: 60 });
  onion = await item("Onion", { cost: 500, stock: 10 });
  sauce = await item("House sauce", { cost: 0, stock: 20 });
});

describe("writing a recipe", () => {
  it("stores the ingredients", async () => {
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [
        { componentItemId: patty, quantityThousandths: 1000 },
        { componentItemId: bun, quantityThousandths: 1000 },
        { componentItemId: onion, quantityThousandths: 200 },
      ],
    });
    const recipe = await getRecipe(tenantId, burger);
    expect(recipe?.components).toHaveLength(3);
  });

  it("replaces rather than merges, so a removed ingredient is really gone", async () => {
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [
        { componentItemId: patty, quantityThousandths: 1000 },
        { componentItemId: onion, quantityThousandths: 200 },
      ],
    });
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [{ componentItemId: patty, quantityThousandths: 1000 }],
    });
    const recipe = await getRecipe(tenantId, burger);
    expect(recipe?.components).toHaveLength(1);
  });

  it("adds two lines for the same ingredient together", async () => {
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [
        { componentItemId: onion, quantityThousandths: 200 },
        { componentItemId: onion, quantityThousandths: 300 },
      ],
    });
    const recipe = await getRecipe(tenantId, burger);
    expect(recipe?.components).toHaveLength(1);
    expect(recipe?.components[0].quantityThousandths).toBe(500);
  });

  it("refuses a dish as its own ingredient", async () => {
    await expect(
      saveRecipe({
        tenantId,
        dishItemId: burger,
        components: [{ componentItemId: burger, quantityThousandths: 1000 }],
      })
    ).rejects.toThrow(/itself/i);
  });

  it("refuses an ingredient from another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other Kitchen", niche: "RETAIL" } });
    const stranger = await prisma.item.create({
      data: { tenantId: other.id, name: "Not yours", unitPriceCents: 0 },
    });
    await expect(
      saveRecipe({
        tenantId,
        dishItemId: burger,
        components: [{ componentItemId: stranger.id, quantityThousandths: 100 }],
      })
    ).rejects.toThrow(/not in this workspace/i);
    await prisma.item.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("refuses an ingredient used in no amount", async () => {
    await expect(
      saveRecipe({
        tenantId,
        dishItemId: burger,
        components: [{ componentItemId: onion, quantityThousandths: 0 }],
      })
    ).rejects.toThrow(/some amount/i);
  });

  it("deletes", async () => {
    await saveRecipe({ tenantId, dishItemId: burger, components: [{ componentItemId: bun, quantityThousandths: 1000 }] });
    expect(await deleteRecipe(tenantId, burger)).toBe(true);
    expect(await getRecipe(tenantId, burger)).toBeNull();
    expect(await deleteRecipe(tenantId, burger)).toBe(false);
  });
});

describe("what a plate costs", () => {
  it("adds the ingredients up and reports the real margin", async () => {
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [
        { componentItemId: patty, quantityThousandths: 1000 }, // R22.00
        { componentItemId: bun, quantityThousandths: 1000 }, // R4.00
        { componentItemId: onion, quantityThousandths: 200 }, // R1.00
      ],
    });
    const cost = await plateCost(tenantId, burger);
    expect(cost?.costCents).toBe(2700);
    expect(cost?.sellingCents).toBe(8500);
    expect(cost?.marginPercent).toBeCloseTo(68.2, 0);
  });

  it("divides a batch by its yield", async () => {
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      yieldQty: 4,
      components: [{ componentItemId: patty, quantityThousandths: 4000 }], // R88 for four
    });
    const cost = await plateCost(tenantId, burger);
    expect(cost?.costCents).toBe(2200);
  });

  it("names the ingredients with no cost rather than treating them as free", async () => {
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [
        { componentItemId: patty, quantityThousandths: 1000 },
        { componentItemId: sauce, quantityThousandths: 100 },
      ],
    });
    // Sauce is costed at zero rather than null here, so use a genuinely
    // uncosted ingredient to prove the reporting.
    const lettuce = await item("Lettuce", { cost: undefined, stock: 10 });
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [
        { componentItemId: patty, quantityThousandths: 1000 },
        { componentItemId: lettuce, quantityThousandths: 100 },
      ],
    });
    const cost = await plateCost(tenantId, burger);
    expect(cost?.missingCosts).toContain("Lettuce");
  });

  it("returns nothing for a dish with no recipe", async () => {
    expect(await plateCost(tenantId, burger)).toBeNull();
  });
});

describe("taking it off the shelf", () => {
  beforeEach(async () => {
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [
        { componentItemId: patty, quantityThousandths: 1000 },
        { componentItemId: onion, quantityThousandths: 200 },
      ],
    });
  });

  it("takes whole units and carries the fraction", async () => {
    const result = await depleteForSale({ tenantId, lines: [{ itemId: burger, quantity: 1 }] });
    expect(result.applied).toBe(true);

    const pattyAfter = await prisma.item.findUniqueOrThrow({ where: { id: patty } });
    const onionAfter = await prisma.item.findUniqueOrThrow({ where: { id: onion } });

    expect(pattyAfter.stockQty).toBe(49);
    // A fifth of an onion is not a whole onion.
    expect(onionAfter.stockQty).toBe(10);

    const carry = await prisma.recipeCarry.findFirstOrThrow({
      where: { tenantId, componentItemId: onion },
    });
    expect(carry.carryThousandths).toBe(200);
  });

  it("takes exactly one onion after five burgers, never six and never none", async () => {
    for (let i = 0; i < 5; i++) {
      await depleteForSale({ tenantId, lines: [{ itemId: burger, quantity: 1 }] });
    }
    const onionAfter = await prisma.item.findUniqueOrThrow({ where: { id: onion } });
    expect(onionAfter.stockQty).toBe(9);

    const carry = await prisma.recipeCarry.findFirstOrThrow({
      where: { tenantId, componentItemId: onion },
    });
    expect(carry.carryThousandths).toBe(0);
  });

  it("handles a multi-portion line in one go", async () => {
    await depleteForSale({ tenantId, lines: [{ itemId: burger, quantity: 5 }] });
    const onionAfter = await prisma.item.findUniqueOrThrow({ where: { id: onion } });
    expect(onionAfter.stockQty).toBe(9);
  });

  it("flags stock going negative instead of hiding it", async () => {
    await prisma.item.update({ where: { id: patty }, data: { stockQty: 1 } });
    const result = await depleteForSale({ tenantId, lines: [{ itemId: burger, quantity: 3 }] });
    const line = result.lines.find((l) => l.componentItemId === patty);
    expect(line?.wentNegative).toBe(true);
  });

  it("leaves untracked ingredients alone", async () => {
    const napkin = await item("Napkin", { cost: 10, stock: null });
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [{ componentItemId: napkin, quantityThousandths: 1000 }],
    });
    const result = await depleteForSale({ tenantId, lines: [{ itemId: burger, quantity: 1 }] });
    expect(result.lines[0].unitsTakenOffStock).toBe(0);
    const after = await prisma.item.findUniqueOrThrow({ where: { id: napkin } });
    expect(after.stockQty).toBeNull();
  });

  it("reports a dish with no recipe rather than failing the sale", async () => {
    const coke = await item("Coke", { price: 2000, stock: 30 });
    const result = await depleteForSale({ tenantId, lines: [{ itemId: coke, quantity: 1 }] });
    expect(result.withoutRecipe).toContain(coke);
  });

  it("does nothing when an inactive recipe is sold", async () => {
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      isActive: false,
      components: [{ componentItemId: patty, quantityThousandths: 1000 }],
    });
    await depleteForSale({ tenantId, lines: [{ itemId: burger, quantity: 1 }] });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: patty } });
    expect(after.stockQty).toBe(50);
  });
});

describe("a recipe inside a recipe", () => {
  it("expands a sub-recipe down to real ingredients", async () => {
    // House sauce: one portion uses one onion.
    await saveRecipe({
      tenantId,
      dishItemId: sauce,
      components: [{ componentItemId: onion, quantityThousandths: 1000 }],
    });
    // A burger uses one portion of sauce and one patty.
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [
        { componentItemId: patty, quantityThousandths: 1000 },
        { componentItemId: sauce, quantityThousandths: 1000 },
      ],
    });

    await depleteForSale({ tenantId, lines: [{ itemId: burger, quantity: 1 }] });

    const onionAfter = await prisma.item.findUniqueOrThrow({ where: { id: onion } });
    const sauceAfter = await prisma.item.findUniqueOrThrow({ where: { id: sauce } });

    // The onion is consumed; the sauce itself is made, not stocked.
    expect(onionAfter.stockQty).toBe(9);
    expect(sauceAfter.stockQty).toBe(20);
  });

  it("stops rather than spinning when two recipes refer to each other", async () => {
    await saveRecipe({
      tenantId,
      dishItemId: sauce,
      components: [{ componentItemId: burger, quantityThousandths: 1000 }],
    });
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [{ componentItemId: sauce, quantityThousandths: 1000 }],
    });

    const result = await depleteForSale({ tenantId, lines: [{ itemId: burger, quantity: 1 }] });
    expect(result).toBeDefined();
  });
});

describe("the menu", () => {
  it("ranks worst margin first", async () => {
    const chips = await item("Chips", { price: 3000 });
    await saveRecipe({
      tenantId,
      dishItemId: burger,
      components: [{ componentItemId: bun, quantityThousandths: 1000 }], // R4 of R85
    });
    await saveRecipe({
      tenantId,
      dishItemId: chips,
      components: [{ componentItemId: patty, quantityThousandths: 1000 }], // R22 of R30
    });

    const rows = await menuMargins(tenantId);
    expect(rows[0].dishName).toBe("Chips");
    expect(rows[1].dishName).toBe("Burger");
  });

  it("lists nothing when there are no recipes", async () => {
    expect(await listRecipes(tenantId)).toHaveLength(0);
    expect(await menuMargins(tenantId)).toHaveLength(0);
  });
});
