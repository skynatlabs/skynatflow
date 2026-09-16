// Generate the deployment's push keys.
//
// Run once, put the two values in the environment, and never regenerate them:
// a new key pair silently invalidates every subscription anybody has already
// granted, and the only symptom is that notifications quietly stop.
//
//   node scripts/generate-vapid-keys.mjs

import { generateKeyPairSync } from "crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const publicDer = publicKey.export({ type: "spki", format: "der" });
const privateDer = privateKey.export({ type: "pkcs8", format: "der" });

const b64url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The uncompressed point is the last 65 bytes of the SPKI structure, and the
// private scalar the 32 bytes after the fixed PKCS#8 prefix. Slicing rather
// than parsing because the prefix for P-256 is fixed and this runs once.
const rawPublic = publicDer.subarray(publicDer.length - 65);
const rawPrivate = privateDer.subarray(36, 68);

console.log("VAPID_PUBLIC_KEY=" + b64url(rawPublic));
console.log("VAPID_PRIVATE_KEY=" + b64url(rawPrivate));
console.log('VAPID_SUBJECT=mailto:hello@skynatflow.com');
console.log("");
console.log("Put these in the environment and do not regenerate them — a new pair");
console.log("silently invalidates every subscription anybody has already granted.");
