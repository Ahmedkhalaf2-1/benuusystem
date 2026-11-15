"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import type { CreateOrderPayload, UpdateOrderPayload } from "@/lib/validations/order";
import { createOrder, updateOrder } from "@/server/services/order-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";

/** Called with a plain object from the order form (groups make FormData awkward). */
export async function createOrderAction(payload: CreateOrderPayload): Promise<ActionResult> {
  const user = await requireUser();
  let orderId = "";
  const failure = await toActionResult(async () => {
    orderId = (await createOrder(prisma, user, payload)).orderId;
  });
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=created`);
}

export async function updateOrderAction(payload: UpdateOrderPayload): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => updateOrder(prisma, user, payload));
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
