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
function createPrismaClient(): PrismaClient {
  const { DATABASE_URL, NODE_ENV } = getEnv();
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Lazily created so importing this module never needs DATABASE_URL at build time. */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
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
