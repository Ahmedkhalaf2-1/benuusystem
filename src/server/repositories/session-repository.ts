import type { DbClient } from "@/lib/db/prisma";
import { publicUserSelect } from "./user-repository";

export function createSession(
  db: DbClient,
  data: { tokenHash: string; userId: string; expiresAt: Date },
) {
  return db.session.create({ data, select: { id: true, expiresAt: true } });
}

export function findSessionWithUser(db: DbClient, tokenHash: string) {
  return db.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      user: { select: publicUserSelect },
    },
  });
}

export function extendSession(db: DbClient, id: string, expiresAt: Date) {
  return db.session.update({ where: { id }, data: { expiresAt } });
}

/** deleteMany so deleting an already-removed session is not an error. */
export function deleteSessionById(db: DbClient, id: string) {
  return db.session.deleteMany({ where: { id } });
}

export function deleteSessionByTokenHash(db: DbClient, tokenHash: string) {
  return db.session.deleteMany({ where: { tokenHash } });
}

export function deleteSessionsForUser(db: DbClient, userId: string) {
  return db.session.deleteMany({ where: { userId } });
}

export function deleteExpiredSessions(db: DbClient, now: Date) {
  return db.session.deleteMany({ where: { expiresAt: { lt: now } } });
}
