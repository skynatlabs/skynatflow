// Prisma 7 config file — Migrate reads its connection info from here
// instead of from the schema's datasource block.
import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * The connection migrations run over, which is not the one the app runs over.
 *
 * Supabase gives two ports on the same pooler host: 6543 is transaction mode
 * and 5432 is session mode. The app wants 6543 — short-lived pooled
 * connections are exactly right for serverless. Migrations cannot use it at
 * all: they take advisory locks, PgBouncer in transaction mode does not
 * support them, and the result is not an error but a hang. A deploy sits at
 * "Building" until it times out, which is a considerably worse failure than
 * a refusal.
 *
 * So: use DIRECT_URL when one is set, otherwise take the app's URL and move
 * it to the session-mode port. The rewrite only touches a Supabase pooler
 * host, so a plain Postgres URL — every local machine, most other hosts — is
 * passed through untouched.
 */
function migrationUrl(): string | undefined {
  const direct = process.env.DIRECT_URL;
  if (direct) return direct;

  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  if (!url.includes("pooler.supabase.com")) return url;

  // Only the port changes. Host, credentials and database stay as they are,
  // so nothing here needs to know the project reference.
  return url.replace(/:6543\b/, ":5432");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl(),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
