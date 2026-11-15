import { Role } from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  createOwnerAdminSchema,
  type CreateOwnerAdminInput,
} from "@/lib/validations/auth";
import { toFieldErrors } from "@/lib/validations/utils";
import {
  countUsersByRole,
  createUser,
  findUserByEmail,
  type PublicUser,
} from "@/server/repositories/user-repository";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/** Arbitrary constant key for the Postgres advisory lock guarding owner creation. */
const OWNER_BOOTSTRAP_LOCK_KEY = 4_270_001;

export async function ownerAdminExists(db: PrismaClient): Promise<boolean> {
  return (await countUsersByRole(db, Role.OWNER_ADMIN)) > 0;
}

/**
 * Creates the first OWNER_ADMIN. Refuses if any owner already exists, so it
 * can never create a second owner by accident. An advisory lock makes two
 * simultaneous runs safe as well.
 */
export async function createFirstOwnerAdmin(
  db: PrismaClient,
  rawInput: CreateOwnerAdminInput,
): Promise<PublicUser> {
  const parsed = createOwnerAdminSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: toFieldErrors(parsed.error),
    });
  }
  const input = parsed.data;

  // Hash before the transaction to keep the lock short.
  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OWNER_BOOTSTRAP_LOCK_KEY})`;

    if ((await countUsersByRole(tx, Role.OWNER_ADMIN)) > 0) {
      throw new AppError("CONFLICT", "يوجد حساب مالك بالفعل. لا يمكن إنشاء حساب مالك آخر من هذا الأمر.");
    }
    if (await findUserByEmail(tx, input.email)) {
      throw new AppError("CONFLICT", "هذا البريد الإلكتروني مستخدم بالفعل.");
    }

    const user = await createUser(tx, {
      name: input.name,
      email: input.email,
      passwordHash,
      role: Role.OWNER_ADMIN,
    });

    await recordAudit(tx, {
      userId: user.id,
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: "User",
      entityId: user.id,
      metadata: { role: user.role, source: "cli:admin:create" },
    });

    return user;
  });
}
