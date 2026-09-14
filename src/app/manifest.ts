import type { MetadataRoute } from "next";

/**
 * The web app manifest.
 *
 * Two jobs. It makes flow installable straight from the browser on Android
 * and desktop — a real icon, no store, no waiting — and it gives the
 * Capacitor shell the same identity, so the installed app and the installed
 * PWA are recognisably one product rather than two.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "flow — business operating system",
    short_name: "flow",
    description:
      "Quotes, invoices, payments, work and customers in one place, with an assistant that can actually do the work.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    // Matches the Admina dark canvas the shell paints, so there is no white
    // flash between the splash screen and the first rendered page.
    background_color: "#0b1120",
    theme_color: "#0b1120",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New quote", url: "/dashboard?new=quote" },
      { name: "Today", url: "/dashboard?view=today" },
    ],
  };
}
