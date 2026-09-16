// The script a business pastes onto their own website.
//
// Kept deliberately tiny and dependency-free: it runs on somebody else's
// page, next to whatever fifteen plugins their site already loads, and the
// one thing it must never do is break that page. No globals beyond a single
// guard, no framework, no polyfills, and every failure is silent rather than
// throwing into a stranger's console.
//
// All it does is turn a <div data-skynat-embed="booking"> into an iframe and
// keep that iframe the right height.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const origin = new URL(request.url).origin;

  const script = `(function () {
  if (window.__skynatEmbed) return;
  window.__skynatEmbed = true;

  var ORIGIN = ${JSON.stringify(origin)};
  var HEIGHTS = { booking: 640, enquiry: 520, "quote-request": 600, pay: 420 };

  function mount(el) {
    if (el.getAttribute("data-skynat-mounted")) return;
    el.setAttribute("data-skynat-mounted", "1");

    var kind = el.getAttribute("data-skynat-embed") || "enquiry";
    var workspace = el.getAttribute("data-workspace");
    if (!workspace) return;

    var src = ORIGIN + "/embed/" + encodeURIComponent(workspace) + "/" + encodeURIComponent(kind);
    var form = el.getAttribute("data-form");
    if (form) src += "?form=" + encodeURIComponent(form);

    var frame = document.createElement("iframe");
    frame.src = src;
    frame.title = "Form";
    frame.loading = "lazy";
    frame.setAttribute("scrolling", "no");
    frame.style.cssText = "width:100%;max-width:640px;border:0;display:block;height:" + (HEIGHTS[kind] || 600) + "px";
    el.appendChild(frame);
  }

  function scan() {
    var nodes = document.querySelectorAll("[data-skynat-embed]");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  window.addEventListener("message", function (event) {
    // Only this origin is listened to. A host page full of other people's
    // scripts posts a great deal of noise, and anything that can resize an
    // element on somebody's site has to be pinned to its sender.
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || data.source !== "skynat-embed" || typeof data.height !== "number") return;
    var frames = document.querySelectorAll("[data-skynat-embed] iframe");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height = Math.max(200, Math.ceil(data.height)) + "px";
      }
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();

  // Site builders render their blocks late and often more than once, so one
  // pass at load is not enough.
  if (window.MutationObserver) {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
`;

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
