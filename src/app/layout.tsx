import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Only used by the "jewel" dashboard skin's editorial greeting headline
// (see .kb-shell[data-skin="jewel"] .kb-hero-greeting in globals.css) —
// loaded globally here since next/font needs a module-level call, but it
// sits unused by every other skin.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["italic", "normal"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "skynat.ai — Six executives for your business",
  description:
    "Invoicing, CRM, and project management that act on your business, not just record it — an agentic platform for how SMEs actually work. By Skynat.",
};

// Without this, phones render the page at a ~980px virtual width and then
// zoom out — every layout below looks correct in a desktop browser window
// resized to phone size, and wrong on an actual phone. userScalable stays on:
// disabling pinch-zoom is an accessibility failure, not a polish detail.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
