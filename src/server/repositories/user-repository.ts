import type { Role } from "@/generated/prisma/enums";
import type { DbClient } from "@/lib/db/prisma";

/** Fields that are safe to pass around the app (never the password hash). */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  permissions: true,
} as const;

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  /** STAFF grants (evaluated by src/lib/auth/permissions.ts). */
  permissions: string[];
};

export function findUserByEmailWithPassword(db: DbClient, email: string) {
  return db.user.findUnique({
    where: { email },
    select: { ...publicUserSelect, passwordHash: true },
  });
}

export function findUserByEmail(db: DbClient, email: string) {
  return db.user.findUnique({ where: { email }, select: publicUserSelect });
}

export function countUsersByRole(db: DbClient, role: Role) {
  return db.user.count({ where: { role } });
}

export function createUser(
  db: DbClient,
  data: { name: string; email: string; passwordHash: string; role: Role; permissions?: string[] },
) {
  return db.user.create({ data, select: publicUserSelect });
}
