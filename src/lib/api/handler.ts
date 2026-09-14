// The wrapper every public API route goes through.
//
// One place that decides what a caller may do, one shape for every response,
// one place errors are turned into status codes. Routes that each do their
// own auth are routes that each get it slightly wrong, and the one that is
// wrong is the one nobody reviews.
//
// Errors are mapped rather than echoed. The core layer throws plain Errors
// with messages written for a person ("Customer not found."), and those are
// safe and useful to return — but the mapping is explicit so that a future
// error carrying something internal cannot leak by default.

import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey, type ApiCaller } from "./keys";
import { AccessDeniedError, assertCan, type Capability } from "@/lib/core/access";

export interface ApiContext {
  caller: ApiCaller;
  req: NextRequest;
  /** Parsed query string, for list endpoints. */
  search: URLSearchParams;
}

type Handler = (ctx: ApiContext) => Promise<unknown>;

export interface RouteOptions {
  /** Capability this route needs. Omit for reads. */
  capability?: Capability;
  /** True for anything that changes data — refused outright for read-only keys. */
  mutates?: boolean;
}

const FAILURE_STATUS: Record<string, number> = {
  missing: 401,
  malformed: 401,
  unknown: 401,
  revoked: 401,
  expired: 401,
  rate_limited: 429,
};

const FAILURE_MESSAGE: Record<string, string> = {
  missing: "Send your key as: Authorization: Bearer flow_sk_...",
  malformed: "That doesn't look like a flow API key.",
  unknown: "That key isn't valid.",
  revoked: "That key has been revoked.",
  expired: "That key has expired.",
  rate_limited: "Too many requests — slow down.",
};

export function apiError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function route(options: RouteOptions, handler: Handler) {
  return async function handle(req: NextRequest): Promise<NextResponse> {
    const verdict = await verifyApiKey(req.headers.get("authorization"));

    if (!verdict.ok) {
      const res = apiError(
        FAILURE_STATUS[verdict.reason] ?? 401,
        FAILURE_MESSAGE[verdict.reason] ?? "Not authorised."
      );
      if (verdict.retryAfter) res.headers.set("Retry-After", String(verdict.retryAfter));
      return res;
    }

    const { caller } = verdict;

    if (options.mutates && caller.readOnly) {
      return apiError(403, "This key is read-only.");
    }

    if (options.capability) {
      try {
        assertCan(caller.role, options.capability);
      } catch (err) {
        if (err instanceof AccessDeniedError) {
          return apiError(403, `A ${caller.role.toLowerCase()} key can't do that.`);
        }
        throw err;
      }
    }

    try {
      const data = await handler({
        caller,
        req,
        search: new URL(req.url).searchParams,
      });
      return NextResponse.json({ ok: true, data });
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return apiError(403, "That key doesn't have permission for this.");
      }
      const message = err instanceof Error ? err.message : "Something went wrong.";

      // Core functions refuse with messages written for a person, and those
      // are the useful thing to return. Anything shaped like a database or
      // runtime failure is logged and replaced, so internals never travel.
      const internal =
        /prisma|invocation|ECONN|ENOTFOUND|undefined is not|cannot read propert/i.test(message);
      if (internal) {
        console.error(`[api:${caller.tenantId}]`, err);
        return apiError(500, "Something went wrong on our side.");
      }
      return apiError(400, message);
    }
  };
}

/** Page a list endpoint the same way everywhere. */
export function paging(search: URLSearchParams) {
  const limit = Math.min(100, Math.max(1, Number(search.get("limit")) || 50));
  const offset = Math.max(0, Number(search.get("offset")) || 0);
  return { limit, offset };
}

/** Reads a JSON body, refusing anything that isn't an object. */
export async function body(req: NextRequest): Promise<Record<string, unknown>> {
  const parsed = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Send a JSON object as the body.");
  }
  return parsed as Record<string, unknown>;
}

export function str(source: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new Error(`"${key}" is required.`);
  return undefined;
}

export function int(source: Record<string, unknown>, key: string, required = false): number | undefined {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (required) throw new Error(`"${key}" is required and must be a number.`);
  return undefined;
}
