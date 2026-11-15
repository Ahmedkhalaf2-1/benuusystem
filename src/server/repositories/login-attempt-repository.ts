import type { DbClient } from "@/lib/db/prisma";

export function recordFailedLoginAttempt(
  db: DbClient,
  data: { email: string; ipAddress: string; createdAt: Date },
) {
  return db.loginAttempt.create({ data, select: { id: true } });
}

export function countFailuresByEmailSince(db: DbClient, email: string, since: Date) {
  return db.loginAttempt.count({ where: { email, createdAt: { gte: since } } });
}

export function countFailuresByIpSince(db: DbClient, ipAddress: string, since: Date) {
  return db.loginAttempt.count({ where: { ipAddress, createdAt: { gte: since } } });
}

export function findOldestFailureSince(
  db: DbClient,
  where: { email?: string; ipAddress?: string },
  since: Date,
) {
  return db.loginAttempt.findFirst({
    where: { ...where, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
}

/** A successful login clears that email's failure history. */
export function clearFailuresForEmail(db: DbClient, email: string) {
  return db.loginAttempt.deleteMany({ where: { email } });
}

export function deleteAttemptsBefore(db: DbClient, before: Date) {
  return db.loginAttempt.deleteMany({ where: { createdAt: { lt: before } } });
}
