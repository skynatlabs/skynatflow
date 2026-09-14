"use client";

// The template editor.
//
// Shaped the way people already expect this tool to work: a rail of panels
// grouped by what you are trying to change, the document itself beside them,
// and one Save for the lot. The previous version was a column of cards with a
// Save button on each, which meant you could change the margins and the table
// and then save only one of them — leaving the document in a shape nobody
// chose.
//
// Every control writes to one piece of state here. The preview is the real
// PDF route, refreshed on demand, because an HTML mock-up of the document
// drifts from the renderer and then confidently lies.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SECTION_BY_KEY,
  SECTION_TABS,
  type SectionConfig,
  type SectionTab,
} from "@/lib/pdf/sections";
import { DOCUMENT_PRESETS } from "@/lib/pdf/presets";
import { PDF_STYLE_LIST, type PdfStyleConfig } from "@/lib/pdf/styles";
import { saveTemplateAction, applyPresetAction } from "./actions";
import { LogoUpload } from "./LogoUpload";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export interface TemplateSettings {
  name: string;
  styleKey: string;
  appliesTo: string;
  accentColorHex: string;
  textColorHex: string;
  mutedColorHex: string;
  backgroundHex: string;
  fontFamily: string;
  fontScale: number;
  headerLayout: string;
  tableHeaderStyle: string;
  logoShape: string;
  pageSize: string;
  orientation: string;
  pageMargin: string;
  marginTopIn: number;
  marginBottomIn: number;
  marginLeftIn: number;
  marginRightIn: number;
}

export interface BusinessDetails {
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  vatNumber: string;
  registrationNumber: string;
}

type PanelKey = "general" | SectionTab;

const PANELS: { key: PanelKey; label: string }[] = [
  { key: "general", label: "General" },
  ...SECTION_TABS.map((t) => ({ key: t.key as PanelKey, label: t.label })),
];

const field =
  "mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2.5 py-1.5 text-sm text-[var(--kb-text)]";
const labelText = "block text-xs font-medium text-[var(--kb-text-dim)]";
const swatch =
  "mt-1 h-9 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)]";

export function TemplateStudio({
  tenantId,
  templateId,
  initialSettings,
  initialSections,
  initialBusiness,
  baseStyle,
  logoDataUrl,
  previewSrc,
  version,
}: {
  tenantId: string;
  templateId: string;
  initialSettings: TemplateSettings;
  initialSections: SectionConfig[];
  initialBusiness: BusinessDetails;
  baseStyle: PdfStyleConfig;
  logoDataUrl: string | null;
  previewSrc: string;
  /** Changes whenever the saved template changes, which refetches the preview. */
  version: string;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelKey>("general");
  const [settings, setSettings] = useState(initialSettings);
  const [sections, setSections] = useState(initialSections);
  const [business, setBusiness] = useState(initialBusiness);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null);

  const set = useCallback(<K extends keyof TemplateSettings>(key: K, value: TemplateSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setDirty(true);
    setInvalidMessage(null);
  }, []);

  const updateSection = useCallback((key: string, patch: Partial<SectionConfig>) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    setDirty(true);
  }, []);

  /**
   * Moves a section within its own zone.
   *
   * Zone-local: the stored array is one list, so swapping with the adjacent
   * index would let a header block slide into the body, where the renderer
   * would place it somewhere nobody asked for.
   */
  const move = useCallback((key: string, direction: -1 | 1) => {
    setSections((prev) => {
      const zone = SECTION_BY_KEY[key].zone;
      const indexes = prev
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => SECTION_BY_KEY[s.key].zone === zone)
        .map(({ i }) => i);

      const at = indexes.findIndex((i) => prev[i].key === key);
      const to = at + direction;
      if (to < 0 || to >= indexes.length) return prev;

      const next = [...prev];
      [next[indexes[at]], next[indexes[to]]] = [next[indexes[to]], next[indexes[at]]];
      return next;
    });
    setDirty(true);
  }, []);

  const payload = useMemo(
    () => JSON.stringify({ settings, sections, business }),
    [settings, sections, business]
  );

  // A new version means the server has the changes; the banner comes down
  // without the client having to guess whether the action succeeded.
  const [savedVersion, setSavedVersion] = useState(version);
  if (version !== savedVersion) {
    setSavedVersion(version);
    if (dirty) setDirty(false);
  }

  const sectionsInPanel = useMemo(
    () => (panel === "general" ? [] : sections.filter((s) => SECTION_BY_KEY[s.key].tab === panel)),
    [panel, sections]
  );

  return (
    // A plain server action, not an inline closure that calls one. Wrapping it
    // meant the submit never reached the server at all: the POST came back
    // 200 and nothing was written, which is the worst way for a save to fail
    // because it looks exactly like a save that worked.
    <form
      action={saveTemplateAction}
      // A form that fails constraint validation submits nothing and, with the
      // invalid field on another panel, shows nothing either. Saying what is
      // wrong beats a Save button that appears broken.
      onInvalid={(e) => {
        const el = e.target as HTMLInputElement;
        setInvalidMessage(el.validationMessage || "Something on another panel isn't valid.");
      }}
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="payload" value={payload} />

      {/* ------------------------------------------------------------ top */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--kb-panel-border)] pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[var(--kb-text)]">Edit template</h1>
          <p className="truncate text-xs text-[var(--kb-text-dim)]">
            {settings.name}
            {dirty && <span className="ml-2">· unsaved changes</span>}
          </p>
          {invalidMessage && (
            <p className="text-xs" style={{ color: "var(--kb-status-danger-ink)" }}>
              {invalidMessage}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="kb-pill kb-pill-ghost text-xs"
          >
            Refresh preview
          </button>
          <SubmitButton className="kb-pill kb-pill-primary text-xs" pendingText="Saving…">
            Save
          </SubmitButton>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* --------------------------------------------------------- rail */}
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {PANELS.map((p) => {
            const active = panel === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPanel(p.key)}
                aria-current={active ? "page" : undefined}
                className="shrink-0 rounded-lg px-3 py-2 text-left text-xs font-medium transition"
                style={{
                  background: active ? "var(--kb-accent-a)" : "var(--kb-panel)",
                  color: active ? "#fff" : "var(--kb-text-dim)",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </nav>

        {/* ------------------------------------------------------- panel */}
        <div className="kb-card min-w-0 space-y-5 p-4 sm:p-5">
          {panel === "general" && (
            <>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
                  Template properties
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className={labelText}>Template name</span>
                    <input
                      value={settings.name}
                      onChange={(e) => set("name", e.target.value)}
                      className={field}
                    />
                  </label>

                  <label>
                    <span className={labelText}>Use this for</span>
                    <select
                      value={settings.appliesTo}
                      onChange={(e) => set("appliesTo", e.target.value)}
                      className={field}
                    >
                      <option value="ALL">Every document</option>
                      <option value="QUOTE">Quotes only</option>
                      <option value="INVOICE">Invoices only</option>
                      <option value="SLIP">Delivery slips only</option>
                    </select>
                  </label>

                  <label>
                    <span className={labelText}>Paper size</span>
                    <select
                      value={settings.pageSize}
                      onChange={(e) => set("pageSize", e.target.value)}
                      className={field}
                    >
                      <option value="A5">A5</option>
                      <option value="A4">A4</option>
                      <option value="LETTER">Letter</option>
                    </select>
                  </label>

                  <fieldset className="sm:col-span-2">
                    <legend className={labelText}>Orientation</legend>
                    <div className="mt-1.5 flex gap-4 text-sm text-[var(--kb-text)]">
                      {(["portrait", "landscape"] as const).map((o) => (
                        <label key={o} className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="orientation-choice"
                            checked={settings.orientation === o}
                            onChange={() => set("orientation", o)}
                          />
                          <span className="capitalize">{o}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="sm:col-span-2">
                    <legend className={labelText}>
                      Margins <span className="font-normal">(inches)</span>
                    </legend>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(
                        [
                          ["marginTopIn", "Top"],
                          ["marginBottomIn", "Bottom"],
                          ["marginLeftIn", "Left"],
                          ["marginRightIn", "Right"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          <span className="block text-[11px] text-[var(--kb-text-dim)]">
                            {label}
                          </span>
                          {/* step="any", not a 0.05 grid. The defaults come
                              from the point-based presets — 40pt is 0.56in —
                              and a stepped input rejects anything off the
                              grid, which made the browser refuse to submit
                              the whole form. Silently: no message, Save just
                              did nothing. */}
                          <input
                            type="number"
                            step="any"
                            min="0"
                            max="3"
                            value={settings[key]}
                            onChange={(e) => set(key, Number(e.target.value))}
                            className={field}
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </div>

              <div className="border-t border-[var(--kb-panel-border)] pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
                  Font
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className={labelText}>Typeface</span>
                    <select
                      value={settings.fontFamily}
                      onChange={(e) => set("fontFamily", e.target.value)}
                      className={field}
                    >
                      <option value="">Default ({baseStyle.fontFamily})</option>
                      <option value="Helvetica">Helvetica (sans-serif)</option>
                      <option value="Times-Roman">Times Roman (serif)</option>
                      <option value="Courier">Courier (monospace)</option>
                    </select>
                  </label>
                  <label>
                    <span className={labelText}>Size</span>
                    <select
                      value={String(settings.fontScale)}
                      onChange={(e) => set("fontScale", Number(e.target.value))}
                      className={field}
                    >
                      <option value="0.85">Small</option>
                      <option value="1">Normal</option>
                      <option value="1.1">Large</option>
                      <option value="1.25">Extra large</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="border-t border-[var(--kb-panel-border)] pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
                  Colours
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className={labelText}>Accent</span>
                    <input
                      type="color"
                      value={settings.accentColorHex || baseStyle.accentColor}
                      onChange={(e) => set("accentColorHex", e.target.value)}
                      className={swatch}
                    />
                  </label>
                  <label>
                    <span className={labelText}>Text</span>
                    <input
                      type="color"
                      value={settings.textColorHex || baseStyle.textColor}
                      onChange={(e) => set("textColorHex", e.target.value)}
                      className={swatch}
                    />
                  </label>
                  <label>
                    <span className={labelText}>Secondary text</span>
                    <input
                      type="color"
                      value={settings.mutedColorHex || baseStyle.mutedColor}
                      onChange={(e) => set("mutedColorHex", e.target.value)}
                      className={swatch}
                    />
                  </label>
                  <label>
                    <span className={labelText}>Page background</span>
                    <input
                      type="color"
                      value={settings.backgroundHex || "#ffffff"}
                      onChange={(e) => set("backgroundHex", e.target.value)}
                      className={swatch}
                    />
                  </label>
                  <label className="sm:col-span-2">
                    <span className={labelText}>Base style</span>
                    <select
                      value={settings.styleKey}
                      onChange={(e) => set("styleKey", e.target.value)}
                      className={field}
                    >
                      {PDF_STYLE_LIST.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="border-t border-[var(--kb-panel-border)] pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
                  Start over from a design
                </h2>
                <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                  Replaces this template&apos;s layout and colours. Saves immediately.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {DOCUMENT_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={async () => {
                        const data = new FormData();
                        data.set("tenantId", tenantId);
                        data.set("templateId", templateId);
                        data.set("presetKey", preset.key);
                        await applyPresetAction(data);
                        setNonce((n) => n + 1);
                        router.refresh();
                      }}
                      className="rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-3 text-left transition hover:border-[var(--kb-accent-a)]"
                    >
                      <span className="block text-sm font-medium text-[var(--kb-text)]">
                        {preset.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-[var(--kb-text-dim)]">
                        {preset.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {panel === "headerFooter" && (
            <>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
                  Logo
                </h2>
                <div className="mt-3">
                  <LogoUpload
                    tenantId={tenantId}
                    templateId={templateId}
                    current={logoDataUrl}
                  />
                </div>
              </div>

              <div className="border-t border-[var(--kb-panel-border)] pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
                  Header layout
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className={labelText}>Arrangement</span>
                    <select
                      value={settings.headerLayout}
                      onChange={(e) => set("headerLayout", e.target.value)}
                      className={field}
                    >
                      <option value="">Default ({baseStyle.headerLayout})</option>
                      <option value="centered">Centred</option>
                      <option value="split">Split (business left, details right)</option>
                      <option value="band">Coloured band</option>
                    </select>
                  </label>
                  <label>
                    <span className={labelText}>Logo shape</span>
                    <select
                      value={settings.logoShape}
                      onChange={(e) => set("logoShape", e.target.value)}
                      className={field}
                    >
                      <option value="">Default ({baseStyle.logoShape})</option>
                      <option value="circle">Circle</option>
                      <option value="square">Square</option>
                      <option value="none">No logo</option>
                    </select>
                  </label>
                </div>
              </div>

              <SectionList
                sections={sectionsInPanel}
                all={sections}
                openKey={openSection}
                setOpenKey={setOpenSection}
                update={updateSection}
                move={move}
              />

              <div className="border-t border-[var(--kb-panel-border)] pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
                  Your business details
                </h2>
                <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                  Printed in the header of every document, on every template. A valid tax invoice
                  needs your address and VAT number.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["businessAddress", "Address", "sm:col-span-2"],
                      ["businessEmail", "Email", ""],
                      ["businessPhone", "Phone", ""],
                      ["vatNumber", "VAT number", ""],
                      ["registrationNumber", "Registration number", ""],
                    ] as const
                  ).map(([key, label, span]) => (
                    <label key={key} className={span}>
                      <span className={labelText}>{label}</span>
                      <input
                        value={business[key]}
                        onChange={(e) => {
                          setBusiness((b) => ({ ...b, [key]: e.target.value }));
                          setDirty(true);
                        }}
                        className={field}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {panel === "table" && (
            <>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
                  Table style
                </h2>
                <label className="mt-3 block">
                  <span className={labelText}>Header row</span>
                  <select
                    value={settings.tableHeaderStyle}
                    onChange={(e) => set("tableHeaderStyle", e.target.value)}
                    className={field}
                  >
                    <option value="">Default ({baseStyle.tableHeaderStyle})</option>
                    <option value="dark">Dark fill</option>
                    <option value="accent">Accent fill</option>
                    <option value="line-only">Line only</option>
                  </select>
                </label>
              </div>
              <SectionList
                sections={sectionsInPanel}
                all={sections}
                openKey={openSection}
                setOpenKey={setOpenSection}
                update={updateSection}
                move={move}
              />
            </>
          )}

          {(panel === "transaction" || panel === "total" || panel === "other") && (
            <SectionList
              sections={sectionsInPanel}
              all={sections}
              openKey={openSection}
              setOpenKey={setOpenSection}
              update={updateSection}
              move={move}
            />
          )}
        </div>

        {/* ------------------------------------------------------ preview */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="kb-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--kb-panel-border)] px-4 py-2.5">
              <p className="text-xs font-semibold text-[var(--kb-text)]">
                Preview
                <span className="ml-2 font-normal text-[var(--kb-text-dim)]">sample data</span>
              </p>
              <a
                href={`${previewSrc}?v=${version}-${nonce}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-medium hover:underline"
                style={{ color: "var(--kb-accent-a)" }}
              >
                Open full size ↗
              </a>
            </div>
            <iframe
              key={`${version}-${nonce}`}
              src={`${previewSrc}?v=${version}-${nonce}`}
              title="Template preview"
              className="h-[78vh] w-full border-0 bg-white"
            />
          </div>
          {dirty && (
            <p className="mt-2 text-[11px] text-[var(--kb-text-dim)]">
              The preview shows the last saved version — press Save to see these changes.
            </p>
          )}
        </div>
      </div>
    </form>
  );
}

/** The blocks belonging to one panel: reorder, show/hide, and open to edit. */
function SectionList({
  sections,
  all,
  openKey,
  setOpenKey,
  update,
  move,
}: {
  sections: SectionConfig[];
  all: SectionConfig[];
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  update: (key: string, patch: Partial<SectionConfig>) => void;
  move: (key: string, direction: -1 | 1) => void;
}) {
  if (sections.length === 0) return null;

  return (
    <div className="border-t border-[var(--kb-panel-border)] pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text)]">
        Blocks
      </h2>
      <ul className="mt-3 space-y-2">
        {sections.map((section) => {
          const def = SECTION_BY_KEY[section.key];
          const isOpen = openKey === section.key;
          const zonePeers = all.filter((s) => SECTION_BY_KEY[s.key].zone === def.zone);
          const at = zonePeers.findIndex((s) => s.key === section.key);

          return (
            <li
              key={section.key}
              className="rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-bg)]"
            >
              <div className="flex items-center gap-2 p-2.5">
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => move(section.key, -1)}
                    disabled={at === 0}
                    aria-label={`Move ${def.label} up`}
                    className="px-1 text-[10px] leading-tight text-[var(--kb-text-dim)] disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(section.key, 1)}
                    disabled={at === zonePeers.length - 1}
                    aria-label={`Move ${def.label} down`}
                    className="px-1 text-[10px] leading-tight text-[var(--kb-text-dim)] disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setOpenKey(isOpen ? null : section.key)}
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="block text-sm font-medium text-[var(--kb-text)]">
                    {def.label}
                    {def.locked && (
                      <span className="ml-2 text-[10px] font-normal text-[var(--kb-text-dim)]">
                        always shown
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--kb-text-dim)]">
                    {def.hint}
                  </span>
                </button>

                {!def.locked && (
                  <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--kb-text-dim)]">
                    <input
                      type="checkbox"
                      checked={section.visible}
                      onChange={(e) => update(section.key, { visible: e.target.checked })}
                      aria-label={`Show ${def.label}`}
                    />
                    Show
                  </label>
                )}
              </div>

              {isOpen && (
                <div className="space-y-3 border-t border-[var(--kb-panel-border)] p-3">
                  {def.title !== undefined && (
                    <label className="block">
                      <span className={labelText}>
                        Heading <span className="font-normal">(empty for none)</span>
                      </span>
                      <input
                        value={section.title ?? ""}
                        onChange={(e) => update(section.key, { title: e.target.value })}
                        placeholder={def.title || "No heading"}
                        className={field}
                      />
                    </label>
                  )}

                  {def.supportsBody && (
                    <label className="block">
                      <span className={labelText}>Text</span>
                      <textarea
                        value={section.body ?? ""}
                        onChange={(e) => update(section.key, { body: e.target.value })}
                        rows={3}
                        placeholder={def.bodyPlaceholder}
                        className={field}
                      />
                    </label>
                  )}

                  {def.supportsSize && (
                    <label className="block">
                      <span className={labelText}>Size</span>
                      <select
                        value={section.size ?? "small"}
                        onChange={(e) =>
                          update(section.key, { size: e.target.value as SectionConfig["size"] })
                        }
                        className={field}
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    </label>
                  )}

                  {def.supportsAlign && (
                    <label className="block">
                      <span className={labelText}>Alignment</span>
                      <select
                        value={section.align ?? "left"}
                        onChange={(e) =>
                          update(section.key, { align: e.target.value as SectionConfig["align"] })
                        }
                        className={field}
                      >
                        <option value="left">Left</option>
                        <option value="center">Centre</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  )}

                  {def.fields && (
                    <fieldset>
                      <legend className={labelText}>What appears</legend>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                        {def.fields.map((f) => (
                          <label
                            key={f.key}
                            className="flex items-center gap-1.5 text-[var(--kb-text)]"
                          >
                            <input
                              type="checkbox"
                              checked={section.fields?.[f.key] !== false}
                              onChange={(e) =>
                                update(section.key, {
                                  fields: { ...(section.fields ?? {}), [f.key]: e.target.checked },
                                })
                              }
                            />
                            {f.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
