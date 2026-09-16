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
    // Long-pressing the icon on a phone's home screen. Four is the most
    // Android shows, and they are the four things somebody opens the app
    // specifically to do rather than the four biggest features.
    shortcuts: [
      { name: "New quote", short_name: "Quote", url: "/dashboard?new=quote" },
      { name: "Today's work", short_name: "Today", url: "/dashboard?view=today" },
      { name: "Photograph a slip", short_name: "Slip", url: "/dashboard?capture=expense" },
      { name: "Field mode", short_name: "Field", url: "/dashboard?view=field" },
    ],
    // A photograph shared into the app from the camera roll lands on the
    // capture screen. The single most common way a receipt actually arrives:
    // somebody photographs it, then shares it, rather than opening anything.
    share_target: {
      action: "/dashboard?capture=expense",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
