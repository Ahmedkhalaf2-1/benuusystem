"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { revokeStaffSessions, setStaffActive, updateStaffPermissions } from "@/server/services/staff-access-service";

/** Owner: save a staff account's permissions (the service checks owner, self-edit and version). */
export async function updatePermissionsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const failure = await toActionResult(() =>
    updateStaffPermissions(prisma, user, {
      userId,
      permissions: formData.getAll("permissions").map(String),
      expectedVersion: Number(formData.get("expectedVersion")),
      revokeSessions: formData.get("revokeSessions") === "yes",
    }),
  );
  if (failure) return failure;
  redirect(`/users/${userId}?saved=permissions`);
}

export async function setActiveAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const active = formData.get("active") === "yes";
  const failure = await toActionResult(() => setStaffActive(prisma, user, { userId, active, expectedVersion: formData.get("expectedVersion") }));
  if (failure) return failure;
  redirect(`/users/${userId}?saved=${active ? "activated" : "deactivated"}`);
}

export async function revokeSessionsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const failure = await toActionResult(() => revokeStaffSessions(prisma, user, { userId }));
  if (failure) return failure;
  redirect(`/users/${userId}?saved=signed-out`);
}
