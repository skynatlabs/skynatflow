// 10 invoice/quote templates + 2 slip templates — a fixed set of real,
// tested design configs (not a page-builder), spanning minimal/modern/
// corporate. A tenant picks one of these as the base for each of their
// saved templates and can override the accent color/logo; the layout
// itself is always this code, never AI-generated, for cost and
// consistency (see docs on the AI proposal generator).

export type PdfFamily = "minimal" | "modern" | "corporate";
export type HeaderLayout = "centered" | "split" | "band";
export type TableHeaderStyle = "dark" | "accent" | "line-only";

export interface PdfStyleConfig {
  key: string;
  label: string;
  family: PdfFamily;
  isSlip: boolean;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  headerLayout: HeaderLayout;
  tableHeaderStyle: TableHeaderStyle;
  fontFamily: "Helvetica" | "Times-Roman" | "Courier";
  logoShape: "circle" | "square" | "none";
}

export const PDF_STYLES: Record<string, PdfStyleConfig> = {
  "minimal-mono": {
    key: "minimal-mono", label: "Minimal Mono", family: "minimal", isSlip: false,
    accentColor: "#1a1a1a", textColor: "#1a1a1a", mutedColor: "#666666",
    headerLayout: "centered", tableHeaderStyle: "dark", fontFamily: "Helvetica", logoShape: "circle",
  },
  "minimal-serif": {
    key: "minimal-serif", label: "Minimal Serif", family: "minimal", isSlip: false,
    accentColor: "#2b2b2b", textColor: "#2b2b2b", mutedColor: "#777777",
    headerLayout: "split", tableHeaderStyle: "line-only", fontFamily: "Times-Roman", logoShape: "none",
  },
  "minimal-sand": {
    key: "minimal-sand", label: "Minimal Sand", family: "minimal", isSlip: false,
    accentColor: "#a9825c", textColor: "#2b2420", mutedColor: "#8a7d6f",
    headerLayout: "centered", tableHeaderStyle: "line-only", fontFamily: "Helvetica", logoShape: "square",
  },
  "modern-coral": {
    key: "modern-coral", label: "Modern Coral", family: "modern", isSlip: false,
    accentColor: "#ff6a3d", textColor: "#1c2333", mutedColor: "#8891a8",
    headerLayout: "band", tableHeaderStyle: "accent", fontFamily: "Helvetica", logoShape: "square",
  },
  "modern-navy": {
    key: "modern-navy", label: "Modern Navy", family: "modern", isSlip: false,
    accentColor: "#1e3a8a", textColor: "#1c2333", mutedColor: "#6b7280",
    headerLayout: "split", tableHeaderStyle: "dark", fontFamily: "Helvetica", logoShape: "square",
  },
  "modern-teal": {
    key: "modern-teal", label: "Modern Teal", family: "modern", isSlip: false,
    accentColor: "#0f766e", textColor: "#1c2333", mutedColor: "#6b7280",
    headerLayout: "band", tableHeaderStyle: "accent", fontFamily: "Helvetica", logoShape: "circle",
  },
  "modern-violet": {
    key: "modern-violet", label: "Modern Violet", family: "modern", isSlip: false,
    accentColor: "#6c5ce7", textColor: "#1c2333", mutedColor: "#8891a8",
    headerLayout: "band", tableHeaderStyle: "accent", fontFamily: "Helvetica", logoShape: "square",
  },
  "corporate-blue": {
    key: "corporate-blue", label: "Corporate Blue", family: "corporate", isSlip: false,
    accentColor: "#0b3d91", textColor: "#12172b", mutedColor: "#5a6072",
    headerLayout: "split", tableHeaderStyle: "dark", fontFamily: "Times-Roman", logoShape: "square",
  },
  "corporate-charcoal": {
    key: "corporate-charcoal", label: "Corporate Charcoal", family: "corporate", isSlip: false,
    accentColor: "#b8860b", textColor: "#1f1f1f", mutedColor: "#6b6b6b",
    headerLayout: "centered", tableHeaderStyle: "dark", fontFamily: "Times-Roman", logoShape: "none",
  },
  "corporate-maroon": {
    key: "corporate-maroon", label: "Corporate Maroon", family: "corporate", isSlip: false,
    accentColor: "#7f1d1d", textColor: "#1f1f1f", mutedColor: "#6b6b6b",
    headerLayout: "split", tableHeaderStyle: "dark", fontFamily: "Times-Roman", logoShape: "square",
  },
  "slip-classic": {
    key: "slip-classic", label: "Classic Slip", family: "minimal", isSlip: true,
    accentColor: "#1a1a1a", textColor: "#1a1a1a", mutedColor: "#666666",
    headerLayout: "centered", tableHeaderStyle: "line-only", fontFamily: "Helvetica", logoShape: "none",
  },
  "slip-modern": {
    key: "slip-modern", label: "Modern Slip", family: "modern", isSlip: true,
    accentColor: "#ff6a3d", textColor: "#1c2333", mutedColor: "#8891a8",
    headerLayout: "band", tableHeaderStyle: "accent", fontFamily: "Helvetica", logoShape: "circle",
  },
};

export const PDF_STYLE_LIST = Object.values(PDF_STYLES);

export function getPdfStyle(key: string): PdfStyleConfig {
  return PDF_STYLES[key] ?? PDF_STYLES["minimal-mono"];
}
