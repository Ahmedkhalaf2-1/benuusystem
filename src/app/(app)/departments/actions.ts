"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import type { RecordReadyPayload, RecordStagePayload } from "@/lib/validations/production";
import {
  createDepartment,
  recordDepartmentReady,
  recordDepartmentStage,
  revokeDepartmentMembership,
  setDepartmentMembership,
  updateDepartment,
} from "@/server/services/department-service";
import { setItemValueSplit, setOrderHiddenFromDepartments } from "@/server/services/order-department-service";

/**
 * Department actions. Every one re-authorizes in its service (membership read
 * from the database, owner checks); nothing here trusts the browser.
 */

const orderPage = (departmentId: string, orderId: unknown, saved: string) => `/departments/${departmentId}/orders/${String(orderId)}?saved=${saved}`;

/** A department member records production on the department's items. */
export async function recordDepartmentStageAction(departmentId: string, payload: RecordStagePayload): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => recordDepartmentStage(prisma, user, departmentId, payload));
  if (failure) return failure;
  redirect(orderPage(departmentId, payload.orderId, payload.alsoReady ? "stage-ready" : "stage"));
}

export async function recordDepartmentReadyAction(departmentId: string, payload: RecordReadyPayload): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => recordDepartmentReady(prisma, user, departmentId, payload));
  if (failure) return failure;
  redirect(orderPage(departmentId, payload.orderId, "ready"));
}

// ─── Owner ───

export async function createDepartmentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => createDepartment(prisma, user, { name: formData.get("name") }));
  if (failure) return failure;
  redirect("/departments/manage?saved=created");
}

export async function updateDepartmentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const active = formData.get("isActive");
  const failure = await toActionResult(() =>
    updateDepartment(prisma, user, {
      departmentId: formData.get("departmentId"),
      ...(formData.has("name") ? { name: formData.get("name") } : {}),
      ...(active === "yes" || active === "no" ? { isActive: active === "yes" } : {}),
    }),
  );
  if (failure) return failure;
  redirect("/departments/manage?saved=updated");
}

/** Grant / change one account's access to one department (from the account page). */
export async function setMembershipAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const failure = await toActionResult(() =>
    setDepartmentMembership(prisma, user, {
      userId,
      departmentId: formData.get("departmentId"),
      canViewWork: formData.get("canViewWork") === "on",
      canViewMoney: formData.get("canViewMoney") === "on",
      canRecordProduction: formData.get("canRecordProduction") === "on",
      canViewCollections: formData.get("canViewCollections") === "on",
      canViewSettlements: formData.get("canViewSettlements") === "on",
    }),
  );
  if (failure) return failure;
  redirect(`/users/${userId}?saved=departments#departments`);
}

export async function revokeMembershipAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const failure = await toActionResult(() => revokeDepartmentMembership(prisma, user, { userId, departmentId: formData.get("departmentId") }));
  if (failure) return failure;
  redirect(`/users/${userId}?saved=department-revoked#departments`);
}

/** Owner: split one item's value across departments (exact amounts), or clear the split. */
export async function setItemValueSplitAction(payload: { orderId: string; orderGroupId: string; shares: { departmentId: string; amount: string }[] }): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => setItemValueSplit(prisma, user, payload));
  if (failure) return failure;
  redirect(`/orders/${payload.orderId}?saved=split#departments`);
}

/** Owner: hide / show an order in department views (partners and members). */
export async function setHiddenFromDepartmentsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  const failure = await toActionResult(() => setOrderHiddenFromDepartments(prisma, user, { orderId, hidden: formData.get("hidden") === "yes" }));
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=departments-visibility#departments`);
}
