import { route } from "@/lib/api/handler";
import { buildCashForecast } from "@/lib/core/cashForecast";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller, search }) => {
  const opening = Number(search.get("openingCents"));
  return buildCashForecast({
    tenantId: caller.tenantId,
    openingCents: Number.isFinite(opening) ? Math.round(opening) : 0,
  });
});
