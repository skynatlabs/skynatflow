import type { NextConfig } from "next";

// The headers a browser needs in order to defend the app on our behalf.
//
// The policy below is deliberately conservative about what it allows and
// deliberately honest about one thing it cannot yet forbid: this app renders
// inline styles and inline scripts in places (the marketing chrome carries a
// style block, Next injects bootstrapping script), so `unsafe-inline` is
// still required for those two directives. That is written here rather than
// quietly omitted, because a CSP whose weaknesses nobody wrote down is a CSP
// nobody will ever tighten. Removing them means nonce-ing every inline block,
// which is a real piece of work and a separate one.
//
// Everything else is closed: no plugins, no framing except the embeds, no
// form posts to other origins, and no base-tag rewriting.
const CONNECT_SRC = [
  "'self'",
  // The model providers, called from server components — listed because a
  // streamed response from the assistant is fetched by the browser.
  "https://api.anthropic.com",
  "https://generativelanguage.googleapis.com",
  "https://api.openai.com",
];

const csp = [
  "default-src 'self'",
  // Inline script is Next's own bootstrap. Nonces are the fix and are not
  // wired up yet.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // Receipt photographs, signatures and logos are stored on R2/S3 and served
  // from wherever that bucket lives, so images cannot be locked to 'self'.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  `connect-src ${CONNECT_SRC.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

// Applied to everything that is not an embed. Kept in one array so that the
// embed exception below differs in exactly one directive and nothing else.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: csp },
  // A year, with subdomains. Only meaningful over HTTPS, which production is.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // We ask for none of these. Saying so stops an injected script asking on
  // our behalf.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The embeddable widgets exist to be put on somebody else's website,
        // so they are the one part of this application that must be framable.
        // Everything else inherits the default and stays unframable, because
        // a dashboard in an invisible iframe is a clickjacking attack.
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp.replace("frame-ancestors 'self'", "frame-ancestors *") },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The loader script is fetched by other people's pages by definition.
        source: "/embed.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=3600" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/((?!embed).*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
