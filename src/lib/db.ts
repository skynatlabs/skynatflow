// Single shared Prisma Client instance, using the Prisma 7 driver-adapter
// pattern (connection URL is passed to the adapter here, not embedded in
// the schema). Every module in lib/core imports `prisma` from here instead
// of constructing its own client.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { withQueryTiming } from "@/lib/perf";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const rawConnectionString = process.env.DATABASE_URL;
  if (!rawConnectionString) {
    // Allow the module to load (so type-checking/build doesn't fail) even
    // before the Phase 0 checkpoint (DATABASE_URL) is resolved. Any actual
    // query will throw a clear error instead of failing silently.
    console.warn(
      "[db] DATABASE_URL is not set — queries will fail until it's configured. See README checkpoint."
    );
  }
  const isSupabase = rawConnectionString?.includes("supabase.com") ?? false;
  // Strip sslmode from the URL: pg's connection-string parser treats
  // sslmode=require as verify-full (as of pg-connection-string's new
  // libpq-aligned semantics), which overrides any explicit `ssl` object
  // passed alongside it and rejects Supabase's pooler cert chain.
  const connectionString = isSupabase
    ? rawConnectionString!.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "")
    : rawConnectionString ?? "";
  // TLS, and whether we check who is on the other end of it.
  //
  // The connection is encrypted either way. What `rejectUnauthorized: false`
  // gives up is authentication of the server — which makes the link
  // confidential but not proof against somebody sitting in the middle of it.
  // An auditor will flag that, correctly, and they should.
  //
  // The honest position: supply DATABASE_CA_CERT (the pooler's CA chain, in
  // PEM) and the connection is verified properly. Without it, verification
  // against Supabase's pooler chain fails outright and the app cannot reach
  // its own database, so the unverified path stays as the fallback — with a
  // warning at boot rather than a comment nobody reads, because a gap that
  // announces itself is a gap that gets closed.
  const ca = process.env.DATABASE_CA_CERT;
  const ssl = ca
    ? { ca, rejectUnauthorized: true }
    : isSupabase
      ? { rejectUnauthorized: false }
      : undefined;

  if (!ca && isSupabase) {
    console.warn(
      "[db] Connecting over TLS without verifying the server certificate. " +
        "Set DATABASE_CA_CERT to the database's CA chain (PEM) to close this."
    );
  }

  const adapter = new PrismaPg({ connectionString, ssl });

  // Timed, so that latency is a number rather than an argument. Slow queries
  // are always recorded and the rest are sampled — see lib/perf.ts for why
  // that is cheap enough to leave on in production.
  return withQueryTiming(new PrismaClient({ adapter }));
}

// Cache the client across invocations in every environment, production
// included — on Vercel a serverless function's execution context is
// often reused ("warm start"), and without this cache each request would
// spin up a brand-new pg.Pool against Supabase's connection pooler. With
// a low pool_size (session pooler defaults to ~15), a handful of
// concurrent requests each opening their own pool exhausts it fast and
// every DB-dependent request — AI commands included — starts failing
// with "max clients reached in session mode".
export const prisma = globalForPrisma.prisma ?? createClient();
globalForPrisma.prisma = prisma;
