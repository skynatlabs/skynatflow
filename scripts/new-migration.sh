#!/usr/bin/env bash
# Generate and apply a migration from the current schema.
#
# Exists because `prisma migrate diff --script` writes its output to stdout
# and the CLI writes its "a new version is available" box to stdout too. The
# box lands inside the .sql file, the migration fails halfway through with a
# syntax error on a box-drawing character, and the database is left with the
# tables from the first half and a migration marked failed.
#
# Usage: scripts/new-migration.sh add_loyalty
set -euo pipefail

NAME="${1:?usage: scripts/new-migration.sh <snake_case_name>}"
DIR="prisma/migrations/$(date +%Y%m%d%H%M%S)_${NAME}"
RAW="$(mktemp)"

npx prisma migrate diff \
  --from-config-datasource prisma.config.ts \
  --to-schema prisma/schema.prisma \
  --script > "$RAW" 2>&1

# Keep only real SQL: drop the config preamble, and cut everything from the
# first box-drawing character onwards.
python3 - "$RAW" <<'PY'
import re, sys
raw = open(sys.argv[1]).read()
sql = re.split(r'[┌│└]', raw)[0]
sql = "\n".join(l for l in sql.splitlines() if not l.startswith("Loaded Prisma config"))
sql = sql.strip()
if not sql:
    sys.exit("No schema changes to migrate.")
if "Error" in sql.splitlines()[0]:
    sys.exit(f"prisma migrate diff failed:\n{sql}")
open(sys.argv[1], "w").write(sql + "\n")
PY

mkdir -p "$DIR"
mv "$RAW" "$DIR/migration.sql"
echo "→ $DIR"

npx prisma migrate deploy 2>&1 | grep -viE '│|┌|└|update available|major update|npm i ' | grep . || true
npx prisma generate 2>&1 | grep -i generated | head -1
