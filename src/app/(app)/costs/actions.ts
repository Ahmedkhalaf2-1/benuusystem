"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { amendCostEntry, closeOrderCosts, recordCostEntry, reopenOrderCosts } from "@/server/services/cost-review-service";

/** «التكاليف» actions. Every rule (owner-only close/amend, versions, suppliers) is re-checked in the service. */
const back = (orderId: string, saved: string) => `/costs/orders/${orderId}?saved=${saved}`;

export async function recordCostEntryAction(payload: Record<string, unknown> & { orderId: string }): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => recordCostEntry(prisma, user, payload));
  if (failure) return failure;
  redirect(back(payload.orderId, "entry"));
}

export async function closeOrderCostsAction(payload: { orderId: string; expectedVersion: number; suppliers: Record<string, string>; confirmZero: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => closeOrderCosts(prisma, user, payload));
  if (failure) return failure;
  redirect(back(payload.orderId, "closed"));
}

export async function reopenOrderCostsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  const failure = await toActionResult(() => reopenOrderCosts(prisma, user, { orderId, expectedVersion: Number(formData.get("expectedVersion")), reason: String(formData.get("reason") ?? "") }));
  if (failure) return failure;
  redirect(back(orderId, "reopened"));
}

export async function amendCostEntryAction(orderId: string, payload: Record<string, unknown>): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => amendCostEntry(prisma, user, payload));
  if (failure) return failure;
  redirect(back(orderId, "amended"));
}
