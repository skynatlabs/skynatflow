"use client";

// The three things a customer actually wants to do.
//
// Every portal in this category is a read-only list of PDFs, so the customer
// goes back to WhatsApp to say they have paid. These are here, on the same
// page as the invoice, and they say plainly what happens next — a person at
// the business reads it. No account, no password, no app.
//
// Photographs of a bank slip come off a phone at four to eight megabytes.
// They are shrunk here, in the browser, before anything is sent.

import { useRef, useState } from "react";

const MAX_EDGE = 1800;
const SHRINK_OVER_BYTES = 700 * 1024;

/**
 * The server's limit, which is on the encoded string rather than the file.
 *
 * These have to be the same number or the check here is theatre: base64
 * inflates by a third, so a 3 MB file passing a 3 MB check arrives as a 4 MB
 * string and is refused after the upload. Check the encoded length, which is
 * the thing that is actually too big.
 */
const MAX_DATA_URL_CHARS = 4 * 1024 * 1024;

async function toDataUrl(file: File): Promise<{ name: string; dataUrl: string } | { error: string }> {
  let out: Blob = file;
  let name = file.name;

  if (file.type.startsWith("image/") && file.size > SHRINK_OVER_BYTES) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
        if (blob && blob.size < file.size) {
          out = blob;
          name = name.replace(/\.[^.]+$/, "") + ".jpg";
        }
      }
      bitmap.close?.();
    } catch {
      // A format the browser cannot decode goes up as it is.
    }
  }

  if (!/^(image\/(png|jpe?g|webp)|application\/pdf)$/.test(out.type)) {
    return { error: "Send a photograph or a PDF." };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(out);
  });

  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    return { error: "That file is too big. A photograph of the slip works better than a scan of it." };
  }
  return { name, dataUrl };
}

export interface PortalActionsProps {
  token: string;
  documents: Array<{ id: string; label: string }>;
  party: { name: string; companyName: string | null; email: string | null; phone: string | null; addressLine: string | null; vatNumber: string | null };
  businessName: string;
  paymentProofAction: (formData: FormData) => Promise<void>;
  messageAction: (formData: FormData) => Promise<void>;
  detailsAction: (formData: FormData) => Promise<void>;
  /** Which panel to open on arrival — set by the "I've paid" button on an invoice. */
  initial?: Tab;
}

type Tab = "paid" | "ask" | "details";

const TABS: Array<{ id: Tab; label: string; blurb: string }> = [
  { id: "paid", label: "I've paid", blurb: "Send the proof and we will match it to your invoice." },
  { id: "ask", label: "Ask a question", blurb: "About an invoice, a delivery, or anything else." },
  { id: "details", label: "My details", blurb: "Correct what appears on your invoices." },
];

export function PortalActions(props: PortalActionsProps) {
  const [tab, setTab] = useState<Tab>(props.initial ?? "paid");
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(files: FileList | null) {
    const chosen = files?.[0];
    if (!chosen) return;
    setError(null);
    const result = await toDataUrl(chosen);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setFile(result);
  }

  function runner(action: (fd: FormData) => Promise<void>, done: string) {
    return async (formData: FormData) => {
      setError(null);
      setBusy(true);
      try {
        await action(formData);
        setSent(done);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      } catch (err) {
        setError(err instanceof Error ? err.message : "That did not go through. Try again.");
      } finally {
        setBusy(false);
      }
    };
  }

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <section className="kb-card mt-6 p-5">
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setSent(null);
              setError(null);
            }}
            className={`kb-pill text-xs ${tab === t.id ? "kb-pill-primary" : "kb-pill-ghost"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--kb-text-dim)]">{active.blurb}</p>

      {sent ? (
        <div className="mt-4 rounded-xl p-4" style={{ background: "var(--kb-tint-mint)" }}>
          <p className="text-sm font-medium text-[var(--kb-text)]">{sent}</p>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            {props.businessName} has been told. You will see it listed below until someone there has dealt with it.
          </p>
          <button type="button" onClick={() => setSent(null)} className="kb-pill kb-pill-ghost mt-3 text-xs">
            Send something else
          </button>
        </div>
      ) : (
        <>
          {tab === "paid" && (
            <form action={runner(props.paymentProofAction, "Your proof of payment is with them.")} className="mt-4 grid gap-2">
              <input type="hidden" name="token" value={props.token} />
              <input type="hidden" name="fileName" value={file?.name ?? ""} />
              <input type="hidden" name="fileDataUrl" value={file?.dataUrl ?? ""} />
              {props.documents.length > 0 && (
                <label className="text-xs text-[var(--kb-text-dim)]">
                  Which invoice?
                  <select name="transactionId" className="kb-input mt-1 w-full text-sm">
                    <option value="">Not sure / more than one</option>
                    {props.documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className="kb-pill kb-pill-ghost text-xs">
                  {file ? "Choose a different file" : "Attach the slip"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept="image/*,application/pdf"
                  onChange={(e) => void pick(e.target.files)}
                />
                {file && <span className="truncate text-xs text-[var(--kb-text)]">{file.name}</span>}
              </div>
              <textarea
                name="note"
                rows={2}
                placeholder="Anything else? “Paid R4 500 on Tuesday from the FNB account.”"
                className="kb-input w-full text-sm"
              />
              <div className="flex justify-end">
                <button type="submit" disabled={busy} className="kb-pill kb-pill-primary text-xs">
                  {busy ? "Sending…" : "Send it"}
                </button>
              </div>
            </form>
          )}

          {tab === "ask" && (
            <form action={runner(props.messageAction, "Your message is with them.")} className="mt-4 grid gap-2">
              <input type="hidden" name="token" value={props.token} />
              {props.documents.length > 0 && (
                <label className="text-xs text-[var(--kb-text-dim)]">
                  About which document? (optional)
                  <select name="transactionId" className="kb-input mt-1 w-full text-sm">
                    <option value="">Nothing in particular</option>
                    {props.documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <textarea name="body" required rows={4} placeholder="Write it here." className="kb-input w-full text-sm" />
              <div className="flex justify-end">
                <button type="submit" disabled={busy} className="kb-pill kb-pill-primary text-xs">
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          )}

          {tab === "details" && (
            <form action={runner(props.detailsAction, "Thank you — they will check it and update your record.")} className="mt-4 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="token" value={props.token} />
              <label className="text-xs text-[var(--kb-text-dim)]">
                Name
                <input name="name" defaultValue={props.party.name} className="kb-input mt-1 w-full text-sm" />
              </label>
              <label className="text-xs text-[var(--kb-text-dim)]">
                Business name
                <input name="companyName" defaultValue={props.party.companyName ?? ""} className="kb-input mt-1 w-full text-sm" />
              </label>
              <label className="text-xs text-[var(--kb-text-dim)]">
                Email
                <input name="email" type="email" defaultValue={props.party.email ?? ""} className="kb-input mt-1 w-full text-sm" />
              </label>
              <label className="text-xs text-[var(--kb-text-dim)]">
                Phone
                <input name="phone" defaultValue={props.party.phone ?? ""} className="kb-input mt-1 w-full text-sm" />
              </label>
              <label className="text-xs text-[var(--kb-text-dim)] sm:col-span-2">
                Address
                <input name="addressLine" defaultValue={props.party.addressLine ?? ""} className="kb-input mt-1 w-full text-sm" />
              </label>
              <label className="text-xs text-[var(--kb-text-dim)]">
                VAT number
                <input name="vatNumber" defaultValue={props.party.vatNumber ?? ""} className="kb-input mt-1 w-full text-sm" />
              </label>
              <div className="flex items-end justify-end sm:col-span-2">
                <button type="submit" disabled={busy} className="kb-pill kb-pill-primary text-xs">
                  {busy ? "Sending…" : "Send the correction"}
                </button>
              </div>
              <p className="text-[11px] text-[var(--kb-text-dim)] sm:col-span-2">
                This is checked before it changes anything — an address that changed itself the day an invoice went out is
                how a document ends up wrong with nobody able to explain it.
              </p>
            </form>
          )}
        </>
      )}

      {error && <p className="mt-3 text-xs text-[var(--kb-tint-peach-ink)]">{error}</p>}
    </section>
  );
}
