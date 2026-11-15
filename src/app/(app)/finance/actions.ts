"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import type { RecordExpensePayload, RecordOrderCostPayload } from "@/lib/validations/finance";
import { recordOrderCost, voidOrderCost } from "@/server/services/cost-service";
import { recordExpense, voidExpense } from "@/server/services/expense-service";
import { payPayable, voidOutgoingPayment } from "@/server/services/outgoing-payment-service";
import { createSupplier, updateSupplier } from "@/server/services/supplier-service";

/** Only same-site relative paths, so a form field can never redirect elsewhere. */
function safeReturnTo(value: FormDataEntryValue | null, fallback: string): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : fallback;
}

/** Adds ?saved=… (keeping existing query and #hash) for the success banner. */
function withSaved(path: string, saved: string): string {
  const url = new URL(path, "http://local");
  url.searchParams.set("saved", saved);
  return `${url.pathname}${url.search}${url.hash}`;
}

// ─── Order costs ───

export async function recordOrderCostAction(payload: RecordOrderCostPayload): Promise<ActionResult> {
  const user = await requireUser();
  let orderId = "";
  const failure = await toActionResult(async () => {
    orderId = (await recordOrderCost(prisma, user, payload)).orderId;
  });
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=cost#costs`);
}

export async function voidOrderCostAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let orderId = "";
  const failure = await toActionResult(async () => {
    orderId = (await voidOrderCost(prisma, user, { id: formData.get("id"), reason: formData.get("reason") })).orderId;
  });
  if (failure) return failure;
  redirect(`/orders/${orderId}?saved=cost-voided#costs`);
}

// ─── Money paid out (costs & expenses) ───

function payFields(formData: FormData) {
  return {
    targetId: formData.get("targetId"),
    idempotencyKey: formData.get("idempotencyKey"),
    amount: formData.get("amount"),
    paidAt: formData.get("paidAt"),
    method: formData.get("method"),
    notes: formData.get("notes") ?? undefined,
  };
}

export async function payCostAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => payPayable(prisma, user, "cost", payFields(formData)));
  if (failure) return failure;
  redirect(withSaved(safeReturnTo(formData.get("returnTo"), "/dashboard"), "paid-out"));
}

export async function payExpenseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => payPayable(prisma, user, "expense", payFields(formData)));
  if (failure) return failure;
  redirect(`/expenses/${String(formData.get("targetId"))}?saved=paid-out`);
}

export async function voidOutgoingPaymentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() =>
    voidOutgoingPayment(prisma, user, { id: formData.get("id"), reason: formData.get("reason") }),
  );
  if (failure) return failure;
  redirect(withSaved(safeReturnTo(formData.get("returnTo"), "/dashboard"), "payment-voided"));
}

// ─── General expenses ───

export async function recordExpenseAction(payload: RecordExpensePayload): Promise<ActionResult> {
  const user = await requireUser();
  let expenseId = "";
  const failure = await toActionResult(async () => {
    expenseId = (await recordExpense(prisma, user, payload)).expenseId;
  });
  if (failure) return failure;
  redirect(`/expenses/${expenseId}?saved=created`);
}

export async function voidExpenseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const failure = await toActionResult(() => voidExpense(prisma, user, { id, reason: formData.get("reason") }));
  if (failure) return failure;
  redirect(`/expenses/${id}?saved=voided`);
}

// ─── Suppliers ───

export async function saveSupplierAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const supplierId = String(formData.get("supplierId") ?? "");
  let id = supplierId;
  const fields = {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
  const failure = await toActionResult(async () => {
    if (supplierId) await updateSupplier(prisma, user, supplierId, fields);
    else id = (await createSupplier(prisma, user, fields)).id;
  });
  if (failure) return failure;
  redirect(`/suppliers/${id}?saved=${supplierId ? "updated" : "created"}`);
}
