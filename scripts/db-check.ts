/**
 * Database connectivity check:  npm run db:check
 *
 * Shows WHICH PostgreSQL the app is configured for (host, port, database,
 * user; never the password), whether it is reachable through Prisma Client,
 * migration status, Phase 1 tables and whether an owner account exists.
 * Read-only: it never changes the database.
 */
import "dotenv/config";
import { readdirSync } from "node:fs";
import path from "node:path";
import { getPrisma } from "@/lib/db/prisma";

const EXPECTED_TABLES = ["users", "sessions", "audit_logs", "login_attempts"];

function describeTarget(url: string | undefined): string {
  if (!url) return "(DATABASE_URL is not set)";
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "") || "(default)";
    return `host=${u.hostname} port=${u.port || "5432"} database=${db} user=${decodeURIComponent(u.username)}`;
  } catch {
    return "(DATABASE_URL is not a valid URL)";
  }
}

function hintFor(error: unknown): string {
  const text = `${(error as { code?: string })?.code ?? ""} ${error instanceof Error ? error.message : String(error)}`;
  if (/ECONNREFUSED|connect/i.test(text)) return "Nothing is listening there. Start the database: npm run db:up";
  if (/28P01|password authentication/i.test(text)) return "Wrong username/password. Compare .env with docker-compose.yml.";
  if (/3D000|does not exist/i.test(text)) return "That database does not exist on this server. Check the database name in .env.";
  if (/ENOTFOUND/i.test(text)) return "Unknown hostname in DATABASE_URL.";
  return "See the error above.";
}

async function main() {
  console.log(`Target: ${describeTarget(process.env.DATABASE_URL)}`);
  const db = getPrisma();
  let ok = true;
  try {
    const [server] = await db.$queryRaw<{ version: string; database: string; port: number }[]>`
      SELECT current_setting('server_version') AS version,
             current_database() AS database,
             inet_server_port() AS port`;
    console.log(`✓ Connected (Prisma Client): PostgreSQL ${server!.version}, database "${server!.database}"`);

    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const present = new Set(tables.map((t) => t.table_name));

    const localMigrations = readdirSync(path.join(process.cwd(), "prisma/migrations"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    let applied: string[] = [];
    if (present.has("_prisma_migrations")) {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      applied = rows.map((r) => r.migration_name);
    }
    const pending = localMigrations.filter((m) => !applied.includes(m));
    if (pending.length === 0) {
      console.log(`✓ Migrations: all ${localMigrations.length} applied`);
    } else {
      ok = false;
      console.log(`✗ Migrations: ${pending.length} pending (${pending.join(", ")}). Run: npm run db:migrate`);
    }

    const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
    if (missing.length === 0) {
      console.log(`✓ Phase 1 tables: ${EXPECTED_TABLES.join(", ")}`);
      const owners = await db.user.count({ where: { role: "OWNER_ADMIN" } });
      console.log(owners > 0 ? `✓ Owner account: exists (${owners})` : "• Owner account: none yet. Run: npm run admin:create");
    } else {
      ok = false;
      console.log(`✗ Missing tables: ${missing.join(", ")}`);
    }
  } catch (error) {
    ok = false;
    console.error(`✗ Cannot use the database: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    console.error(`  Hint: ${hintFor(error)}`);
  } finally {
    await db.$disconnect();
  }
  process.exitCode = ok ? 0 : 1;
}

void main();
