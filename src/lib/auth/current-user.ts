import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import {
  validateSessionToken,
  type ValidatedSession,
} from "@/server/services/auth-service";
import type { PublicUser } from "@/server/repositories/user-repository";
import { hasPermission, type Permission } from "./permissions";
import { readSessionToken } from "./session";

/**
 * Data Access Layer entry point for "who is making this request?".
 * Validated against the database on every request (deduplicated per request
 * with React `cache`). Never trust anything the client sends about the user.
 */
export const getCurrentSession = cache(async (): Promise<ValidatedSession | null> => {
  const token = await readSessionToken();
  return validateSessionToken(prisma, token);
});

export async function getCurrentUser(): Promise<PublicUser | null> {
  return (await getCurrentSession())?.user ?? null;
}

/** For pages and server actions: redirects to /login when not signed in. */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For PAGES that need a specific permission: sends the user to a clear
 * "owner only" page instead of the generic error screen.
 */
export async function requirePermission(permission: Permission): Promise<PublicUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) redirect("/no-access");
  return user;
}

/** For route handlers: throws AppError (401/403) instead of redirecting. */
export async function requireApiUser(permission?: Permission): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (permission && !hasPermission(user, permission)) throw new AppError("FORBIDDEN");
  return user;
}
