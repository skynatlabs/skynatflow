"use client";

// At the scene, on a phone: what happened, the other party, photographs
// from the camera, and the position. The pack says what it still lacks.

import { useState } from "react";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export function IncidentForm({
  action,
  vehicles,
}: {
  action: (formData: FormData) => void;
  vehicles: Array<{ id: string; name: string }>;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      const r = new FileReader();
      r.onload = () => setPhotos((p) => [...p, r.result as string]);
      r.readAsDataURL(f);
    }
  }

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  }

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="photos" value={photos.join("\n")} />
      <input type="hidden" name="lat" value={pos?.lat ?? ""} />
      <input type="hidden" name="lng" value={pos?.lng ?? ""} />
      <label className="text-xs sm:col-span-2">
        <span className="text-[var(--kb-text-dim)]">What happened</span>
        <textarea name="description" required rows={3} className="kb-input mt-1 w-full text-sm" placeholder="Where you were, what the other vehicle did, any injuries." />
      </label>
      <label className="text-xs">
        <span className="text-[var(--kb-text-dim)]">Vehicle</span>
        <select name="assetId" className="kb-input mt-1 w-full text-sm" defaultValue="">
          <option value="">—</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <label className="text-xs">
        <span className="text-[var(--kb-text-dim)]">Other party</span>
        <input name="otherParty" className="kb-input mt-1 w-full text-sm" placeholder="Name, plate, insurer, phone" />
      </label>
      <label className="text-xs">
        <span className="text-[var(--kb-text-dim)]">Photographs ({photos.length})</span>
        <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => addFiles(e.target.files)} className="mt-1 block text-xs" />
      </label>
      <div className="flex items-end gap-2 text-xs">
        <button type="button" onClick={locate} className="kb-pill kb-pill-ghost text-xs">{locating ? "Finding…" : pos ? "Position recorded" : "Record where"}</button>
        <SubmitButton pendingText="Saving…">Report it</SubmitButton>
      </div>
    </form>
  );
}
