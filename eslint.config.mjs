import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party templates kept locally for design reference only — not
    // app code. Their vendored minified JS produced ~1,500 of the 1,700
    // lint problems in this repo and drowned out every real finding.
    "automation-saas/**",
    "SassTech/**",
    "admina-tailwind-admin/**",
    "apps/driver/**",
    "apps/desktop/**",
    // The Android shell. Its own project, its own toolchain, and the Gradle
    // build output contains Capacitor's generated native-bridge.js — vendored
    // JS that produced every lint warning in the repo and none of them real.
    "mobile/**",
  ]),
  {
    // @react-pdf/renderer's <Image> renders into a PDF, not the DOM — it has
    // no alt attribute to set, so the DOM a11y rule can't apply here.
    files: ["src/lib/pdf/**/*.tsx"],
    rules: { "jsx-a11y/alt-text": "off" },
  },
]);

export default eslintConfig;
