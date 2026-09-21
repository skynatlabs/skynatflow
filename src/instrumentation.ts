// Where the server tells us something broke.
//
// Next calls onRequestError when it captures a server error, which is the
// only place that sees every one of them — a page, a server action, a route
// handler, a server component render.
//
// The recorder is imported dynamically and only under the Node runtime.
// Next bundles this file for the Edge runtime as well, and the recorder
// reaches for node:crypto and the database, neither of which exists there —
// a static import makes that a build warning today and a broken edge bundle
// the day somebody adds an edge route. Nothing in this application runs on
// the edge at present, so nothing is lost by the guard.
//
// See src/lib/errors.ts for why errors are recorded to our own database
// rather than only forwarded to a provider.

import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { captureError } = await import("@/lib/errors");
  const message = err instanceof Error ? err.message : String(err);
  const digest =
    typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;

  await captureError({
    message,
    digest,
    route: request.path,
    method: request.method,
    // "server-component render", "route handler", and so on — the fastest way
    // to tell a broken page from a broken API.
    source: `${context.routerKind}:${context.routeType}`,
    stack: err instanceof Error ? err.stack : undefined,
  });
};
