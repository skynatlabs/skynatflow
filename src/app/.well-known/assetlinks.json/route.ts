// Android App Links verification.
//
// Serving this from the domain is what lets a flow link in an email or a
// WhatsApp message open the app directly, on the right screen, already signed
// in — instead of bouncing the person into a browser.
//
// The fingerprint comes from the release keystore and is therefore an env
// var, not a committed constant: it differs per signing key, and hardcoding
// one guarantees the file is wrong the first time the key is rotated.

import { NextResponse } from "next/server";

const PACKAGE_NAME = "co.skynat.flow";

export async function GET() {
  const fingerprints = (process.env.ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);

  // An empty list is served rather than a broken file: Android treats a
  // malformed assetlinks as a hard failure, and an honest empty array simply
  // means "not verified yet".
  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}
