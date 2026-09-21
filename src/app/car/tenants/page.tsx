import { TenantListClient } from "./TenantListClient";

export default function CarTenantsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Tenants</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every business on the platform. This is visibility only, not access: opening a tenant&apos;s
        actual dashboard still requires a real membership on that tenant, same as anyone else.
        What each one pays, and what its agent costs us to run, is on{" "}
        <a href="/car/margins" className="underline">Margins</a>.
      </p>

      <div className="mt-6">
        <TenantListClient />
      </div>
    </div>
  );
}
