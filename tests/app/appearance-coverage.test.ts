// Every skin the platform defines has to be selectable.
//
// The appearance page listed five skins while the model defined eight, so
// jewel, summer and admina existed, worked, and could not be chosen by
// anybody. Admina is the one that changes the navigation entirely, which is
// exactly the one somebody would go looking for and not find.
//
// Same failure as the sidebar test next door: built, correct, no door. The
// cause is the same too — a hand-maintained list beside a source of truth,
// with nothing holding them together.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { COLOR_SKIN_LABELS } from "../../src/lib/ai/model";

const PAGE = join(process.cwd(), "src/app/car/appearance/page.tsx");

function offeredSkins(): Set<string> {
  const src = readFileSync(PAGE, "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/id:\s*"([a-z]+)"/g)) found.add(m[1]);
  return found;
}

describe("the appearance page", () => {
  it("offers every skin the platform defines", () => {
    const defined = Object.keys(COLOR_SKIN_LABELS);
    const offered = offeredSkins();

    const missing = defined.filter((s) => !offered.has(s));
    expect(
      missing,
      "these skins exist and render but cannot be selected — add them to the " +
        "list on the appearance page"
    ).toEqual([]);
  });

  it("does not offer a skin that no longer exists", () => {
    // A button that sets a skin the model dropped would write a value
    // getPlatformColorSkin rejects, silently falling back to the default —
    // which looks like the click did nothing.
    const defined = new Set(Object.keys(COLOR_SKIN_LABELS));
    const stale = [...offeredSkins()].filter((s) => !defined.has(s));
    expect(stale, "these are offered but no longer defined").toEqual([]);
  });

  it("gives each skin its own swatches and description", () => {
    const src = readFileSync(PAGE, "utf8");
    // A skin with no help text is a coloured circle and a name, which tells
    // an owner nothing about what they are about to change for every tenant.
    const helpTexts = [...src.matchAll(/helpText:\s*\n?\s*"/g)].length;
    const swatchSets = [...src.matchAll(/swatches:\s*\[/g)].length;
    const count = Object.keys(COLOR_SKIN_LABELS).length;

    expect(helpTexts).toBe(count);
    expect(swatchSets).toBe(count);
  });
});
