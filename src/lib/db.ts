// Single shared Prisma Client instance, using the Prisma 7 driver-adapter
// pattern (connection URL is passed to the adapter here, not embedded in
// the schema). Every module in lib/core imports `prisma` from here instead
// of constructing its own client.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Allow the module to load (so type-checking/build doesn't fail) even
    // before the Phase 0 checkpoint (DATABASE_URL) is resolved. Any actual
    // query will throw a clear error instead of failing silently.
    console.warn(
      "[db] DATABASE_URL is not set — queries will fail until it's configured. See README checkpoint."
    );
  }
  const adapter = new PrismaPg({ connectionString: connectionString ?? "" });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
