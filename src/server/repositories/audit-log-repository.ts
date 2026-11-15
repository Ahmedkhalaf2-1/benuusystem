import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db/prisma";

export function insertAuditLog(
  db: DbClient,
  data: {
    userId: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  return db.auditLog.create({ data, select: { id: true } });
}
