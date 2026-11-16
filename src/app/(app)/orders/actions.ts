"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import type { CreateOrderPayload, UpdateOrderPayload } from "@/lib/validations/order";
import { archiveOrder, restoreOrder } from "@/server/services/order-archive-service";
import { createOrder, updateOrder } from "@/server/services/order-service";
import { updateOrderAccess } from "@/server/services/order-visibility-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";

/** Called with a plain object from the order form (groups make FormData awkward). */
/** `access`: «ظهور الأوردر للعمال» — only honoured for the owner (the service enforces it). */
export async function createOrderAction(payload: CreateOrderPayload, access?: unknown): Promise<ActionResult> {
  const user = await requireUser();
  let orderId = "";
  const failure = await toActionResult(async () => {
    orderId = (await createOrder(prisma, user, payload, access)).orderId;
  });
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=created`);
}

export async function updateOrderAction(payload: UpdateOrderPayload, access?: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => updateOrder(prisma, user, payload, access));
  if (failure) return failure;
  redirect(`/orders/${String(payload.orderId)}?saved=updated`);
}

export async function recordPaymentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  const failure = await toActionResult(() =>
    recordPayment(prisma, user, {
      orderId,
      idempotencyKey: formData.get("idempotencyKey"),
      amount: formData.get("amount"),
      paidAt: formData.get("paidAt"),
      method: formData.get("method"),
      notes: formData.get("notes") ?? undefined,
    }),
  );
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=payment`);
}

export async function voidPaymentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let orderId = "";
  const failure = await toActionResult(async () => {
    orderId = (
      await voidPayment(prisma, user, { paymentId: formData.get("paymentId"), reason: formData.get("reason") })
    ).orderId;
  });
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=voided`);
}

/** «حذف الأوردر» (owner): archives an untouched order; the service refuses anything else. */
export async function archiveOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  if (formData.get("confirm") !== "yes") return { ok: false, message: "أكّد الحذف الأول", fieldErrors: { confirm: ["أكّد الحذف الأول"] } };
  const failure = await toActionResult(() => archiveOrder(prisma, user, { orderId, reason: formData.get("reason") }));
  if (failure) return failure;
  redirect(`/orders?status=archived&saved=archived`);
}

export async function restoreOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  const failure = await toActionResult(() => restoreOrder(prisma, user, { orderId }));
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=restored`);
}

/** Owner: change «ظهور الأوردر للعمال» from the order page. */
export async function updateOrderAccessAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  let access: unknown;
  try {
    access = JSON.parse(String(formData.get("access") ?? "null"));
  } catch {
    return { ok: false, message: "صيغة البيانات المرسلة غير صحيحة" };
  }
  const failure = await toActionResult(() => updateOrderAccess(prisma, user, { orderId, access }));
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=access`);
}
