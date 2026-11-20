import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

/**
 * The single PrismaClient for the whole process.
 *
 * Only server code may import this (route handlers, server actions,
 * server components, services, CLI scripts). Client components must never
 * import it — the `pg` driver cannot be bundled for the browser anyway.
 */
/**
 * Connection pool. Measured on production (2026-11-20): with pg's default 10 s
 * idle timeout, every request after a 10 s pause re-opened its connections
 * (TCP + SCRAM auth) and took ~2× longer (dashboard 71 ms cold vs 30–40 ms
 * warm). People pause longer than 10 s between clicks, so most requests paid
 * it. Keeping idle connections for 10 minutes (with TCP keep-alive) removes
 * that fixed cost; at most `max` connections are held (Postgres allows 100).
 * A broken idle connection (e.g. a database restart) is dropped and logged by
 * the adapter's pool error handler — it never crashes the process.
 */
export const DB_POOL_DEFAULTS = { max: 10, idleTimeoutMillis: 10 * 60_000 } as const;

function poolNumber(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createPrismaClient(): PrismaClient {
  const { DATABASE_URL, NODE_ENV } = getEnv();
  const adapter = new PrismaPg(
    {
      connectionString: DATABASE_URL,
      max: poolNumber(process.env.DB_POOL_MAX, DB_POOL_DEFAULTS.max),
      idleTimeoutMillis: poolNumber(process.env.DB_POOL_IDLE_MS, DB_POOL_DEFAULTS.idleTimeoutMillis),
      keepAlive: true,
    },
    { onPoolError: (err) => console.warn(`[db] idle connection dropped: ${err.message}`) },
  );
  return new PrismaClient({
    adapter,
    log: NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * The client is cached on globalThis so dev hot-reloads don't open a new pool
 * on every edit. We also remember WHICH generated PrismaClient class built it:
 * after `prisma generate` (e.g. a new migration) hot-reload brings a new class,
 * and a client from the old class would lack the new models
 * ("Cannot read properties of undefined (reading 'findMany')").
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaClass?: typeof PrismaClient;
};

/** Lazily created so importing this module never needs DATABASE_URL at build time. */
export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma && globalForPrisma.prismaClass !== PrismaClient) {
    // Stale client from before the schema was regenerated: close it and rebuild.
    void globalForPrisma.prisma.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
    globalForPrisma.prismaClass = PrismaClient;
  }
  return globalForPrisma.prisma;
}

/** Use inside `prisma.$transaction(async (tx) => ...)` callbacks. */
export type DbTransaction = Prisma.TransactionClient;

/**
 * Either the root client or a transaction client. Repository functions take
 * this as their first argument so services can compose them in one transaction.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
