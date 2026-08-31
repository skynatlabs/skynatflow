"use client";

import { useState } from "react";
import { updateCustomerAction } from "./actions";

const inputClass =
  "mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-white px-2.5 py-2 text-sm text-[var(--kb-text)]";

export function EditCustomerForm({
  tenantId,
  customerId,
  party,
}: {
  tenantId: string;
  customerId: string;
  party: {
    name: string;
    companyName: string | null;
    phone: string | null;
    email: string | null;
    vatNumber: string | null;
    addressLine: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
    notes: string | null;
  };
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="kb-pill kb-pill-ghost text-xs">
        Edit details
      </button>
    );
  }

  return (
    <form action={updateCustomerAction} className="kb-card mt-4 grid grid-cols-2 gap-3 p-5">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="customerId" value={customerId} />
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Name *</span>
        <input name="name" required defaultValue={party.name} className={inputClass} />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Company</span>
        <input name="companyName" defaultValue={party.companyName ?? ""} className={inputClass} />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Phone (WhatsApp)</span>
        <input name="phone" defaultValue={party.phone ?? ""} className={inputClass} />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Email</span>
        <input name="email" type="email" defaultValue={party.email ?? ""} className={inputClass} />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">VAT number</span>
        <input name="vatNumber" defaultValue={party.vatNumber ?? ""} className={inputClass} />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Address</span>
        <input name="addressLine" defaultValue={party.addressLine ?? ""} className={inputClass} />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">City</span>
        <input name="city" defaultValue={party.city ?? ""} className={inputClass} />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Postal code</span>
        <input name="postalCode" defaultValue={party.postalCode ?? ""} className={inputClass} />
      </label>
      <label className="text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Country</span>
        <input name="country" defaultValue={party.country ?? ""} className={inputClass} />
      </label>
      <label className="col-span-2 text-xs">
        <span className="block font-medium text-[var(--kb-text-dim)]">Notes</span>
        <input name="notes" defaultValue={party.notes ?? ""} className={inputClass} />
      </label>
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="kb-pill kb-pill-ghost text-xs">
          Cancel
        </button>
        <button type="submit" className="kb-pill kb-pill-primary text-xs" onClick={() => setOpen(false)}>
          Save
        </button>
      </div>
    </form>
  );
}
