"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import type { RecordDeliveryPayload, RecordReadyPayload, RecordStagePayload } from "@/lib/validations/production";
import {
  recordDelivery,
  recordReady,
  recordStageProgress,
  voidDelivery,
  voidReady,
  voidStageProgress,
} from "@/server/services/production-service";

const back = (orderId: unknown, saved: string) => `/orders/${String(orderId)}?saved=${saved}#production`;

export async function recordStageAction(payload: RecordStagePayload): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => recordStageProgress(prisma, user, payload));
  if (failure) return failure;
  redirect(back(payload.orderId, payload.alsoReady ? "stage-ready" : "stage"));
}

export async function recordReadyAction(payload: RecordReadyPayload): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => recordReady(prisma, user, payload));
  if (failure) return failure;
  redirect(back(payload.orderId, "ready"));
}

export async function recordDeliveryAction(payload: RecordDeliveryPayload): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => recordDelivery(prisma, user, payload));
  if (failure) return failure;
  redirect(back(payload.orderId, "delivered"));
}

function voidAction(fn: typeof voidStageProgress) {
  return async (formData: FormData) => {
    const user = await requireUser();
    let orderId = "";
    const failure = await toActionResult(async () => {
      orderId = (await fn(prisma, user, { id: formData.get("id"), reason: formData.get("reason") })).orderId;
    });
    return { failure, orderId };
  };
}

export async function voidStageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { failure, orderId } = await voidAction(voidStageProgress)(formData);
  if (failure) return failure;
  redirect(back(orderId, "production-voided"));
}

export async function voidReadyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { failure, orderId } = await voidAction(voidReady)(formData);
  if (failure) return failure;
  redirect(back(orderId, "production-voided"));
}

export async function voidDeliveryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { failure, orderId } = await voidAction(voidDelivery)(formData);
  if (failure) return failure;
  redirect(back(orderId, "delivery-voided"));
}
