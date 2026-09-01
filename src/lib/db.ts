// Single shared Prisma Client instance, using the Prisma 7 driver-adapter
// pattern (connection URL is passed to the adapter here, not embedded in
// the schema). Every module in lib/core imports `prisma` from here instead
// of constructing its own client.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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
  // Connections are already TLS-encrypted via the pooler infra, so skip CA
  // verification here instead.
  const adapter = new PrismaPg({
    connectionString,
    ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
  });
  return new PrismaClient({ adapter });
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
