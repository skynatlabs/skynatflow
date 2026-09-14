import type { CapacitorConfig } from "@capacitor/cli";

/**
 * flow for Android.
 *
 * A native shell over the live workspace rather than a reimplementation of
 * it. That is a deliberate choice, not a shortcut: the web app is 63 pages
 * deep and still moving weekly, and a parallel native client would be behind
 * from the day it shipped — which is exactly the complaint people make about
 * the mobile apps in this category ("missing features, less reliable than
 * desktop").
 *
 * What makes it an app rather than a bookmark is everything around the web
 * view: push notifications, the camera, offline capture, hardware back, and
 * a launcher icon. Those come next, and they come natively.
 *
 * FLOW_URL is where it points. Change it here (or set it before a build) and
 * re-run `npm run sync`.
 */
const FLOW_URL = process.env.FLOW_URL ?? "https://skynatflow.com";

const config: CapacitorConfig = {
  appId: "co.skynat.flow",
  appName: "flow",
  webDir: "www",

  server: {
    url: FLOW_URL,
    // https rather than capacitor://, so cookies, OAuth redirects and the
    // session all behave exactly as they do in a browser. Auth is the first
    // thing a custom scheme breaks.
    androidScheme: "https",
    cleartext: false,
    // Everything the app is allowed to navigate to in-place. Anything else
    // opens in the system browser, so a link in a customer note can never
    // quietly take over the app's window.
    allowNavigation: [
      "skynatflow.com",
      "*.skynatflow.com",
      "accounts.google.com",
      "*.googleusercontent.com",
    ],
    // Shown when the device cannot reach flow at all. Without it the user
    // gets Chrome's grey dinosaur inside our app, which reads as the app
    // being broken rather than the signal being gone.
    errorPath: "index.html",
  },

  android: {
    // The shell should look like the product, not like a browser.
    backgroundColor: "#0b1120",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: "#0b1120",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b1120",
    },
  },
};

export default config;
