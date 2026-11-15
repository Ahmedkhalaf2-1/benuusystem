"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import type { PayWorkerPayload, RecordWorkLogPayload, WorkerFormValues } from "@/lib/validations/workers";
import { recordWorkday, recordWorkLog, voidWorkday, voidWorkLog } from "@/server/services/work-service";
import { payWorker } from "@/server/services/worker-payment-service";
import { createWorker, updateWorker } from "@/server/services/worker-service";

export async function saveWorkerAction(workerId: string | null, values: WorkerFormValues): Promise<ActionResult> {
  const user = await requireUser();
  let id = workerId ?? "";
  const failure = await toActionResult(async () => {
    if (workerId) await updateWorker(prisma, user, workerId, values);
    else id = (await createWorker(prisma, user, values)).id;
  });
  if (failure) return failure;
  redirect(`/workers/${id}?saved=${workerId ? "updated" : "created"}`);
}

/** Attendance form and the one-tap "حضر النهارده" button on the list. */
export async function recordWorkdayAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const workerId = String(formData.get("workerId") ?? "");
  const wage = String(formData.get("wage") ?? "").trim();
  const failure = await toActionResult(() =>
    recordWorkday(prisma, user, {
      workerId,
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      workDate: String(formData.get("workDate") ?? ""),
      worked: formData.get("worked") !== "false",
      wage: wage || undefined,
      notes: String(formData.get("notes") ?? ""),
    }),
  );
  if (failure) return failure;
  redirect(formData.get("from") === "list" ? "/workers?saved=attendance" : `/workers/${workerId}?saved=workday`);
}

export async function recordWorkLogAction(payload: RecordWorkLogPayload): Promise<ActionResult> {
  const user = await requireUser();
  let createdWorkday = false;
  const failure = await toActionResult(async () => {
    createdWorkday = (await recordWorkLog(prisma, user, payload)).createdWorkday;
  });
  if (failure) return failure;
  redirect(`/workers/${String(payload.workerId)}?saved=${createdWorkday ? "work-and-day" : "work"}`);
}

export async function payWorkerAction(payload: PayWorkerPayload): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => payWorker(prisma, user, payload));
  if (failure) return failure;
  redirect(`/workers/${String(payload.workerId)}?saved=${payload.type === "ADVANCE" ? "advance" : "paid"}`);
}

export async function voidWorkdayAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let workerId = "";
  const failure = await toActionResult(async () => {
    workerId = (await voidWorkday(prisma, user, { id: formData.get("id"), reason: formData.get("reason") })).workerId;
  });
  if (failure) return failure;
  redirect(`/workers/${workerId}?saved=day-voided`);
}

export async function voidWorkLogAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let workerId = "";
  const failure = await toActionResult(async () => {
    workerId = (await voidWorkLog(prisma, user, { id: formData.get("id"), reason: formData.get("reason") })).workerId;
  });
  if (failure) return failure;
  redirect(`/workers/${workerId}?saved=log-voided`);
}
