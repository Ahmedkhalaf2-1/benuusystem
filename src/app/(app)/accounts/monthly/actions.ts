"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { isValidMonth } from "@/lib/finance/profitability";
import {
  confirmMonth,
  createRecurringExpense,
  generateFixedExpenses,
  reopenMonth,
  setRecurringActive,
} from "@/server/services/profitability-service";

function monthOf(formData: FormData): string {
  const m = String(formData.get("month") ?? "");
  return isValidMonth(m) ? m : "";
}

function back(month: string, basis: FormDataEntryValue | null, saved: string) {
  const qs = new URLSearchParams({ ...(month ? { month } : {}), ...(basis === "BOOKING" ? { basis: "BOOKING" } : {}), saved });
  return `/accounts/monthly?${qs.toString()}`;
}

export async function confirmMonthAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const month = monthOf(formData);
  const failure = await toActionResult(() =>
    confirmMonth(prisma, user, {
      month,
      basis: formData.get("basis"),
      expectedVersion: formData.get("expectedVersion"),
      acknowledge: formData.get("acknowledge") === "on",
      notes: formData.get("notes"),
    }),
  );
  if (failure) return failure;
  redirect(back(month, formData.get("basis"), "confirmed"));
}

export async function reopenMonthAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const month = monthOf(formData);
  const failure = await toActionResult(() => reopenMonth(prisma, user, { month, expectedVersion: formData.get("expectedVersion"), reason: formData.get("reason") }));
  if (failure) return failure;
  redirect(back(month, formData.get("basis"), "reopened"));
}

export async function generateFixedAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const month = monthOf(formData);
  const failure = await toActionResult(() => generateFixedExpenses(prisma, user, { month }));
  if (failure) return failure;
  redirect(back(month, formData.get("basis"), "fixed"));
}

export async function createRecurringAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() =>
    createRecurringExpense(prisma, user, {
      category: formData.get("category"),
      description: formData.get("description"),
      amount: formData.get("amount"),
      dayOfMonth: formData.get("dayOfMonth"),
      startMonth: formData.get("startMonth"),
      endMonth: formData.get("endMonth"),
    }),
  );
  if (failure) return failure;
  redirect("/expenses/recurring?saved=created");
}

export async function setRecurringActiveAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => setRecurringActive(prisma, user, { id: formData.get("id"), active: formData.get("active") === "true" }));
  if (failure) return failure;
  redirect("/expenses/recurring?saved=updated");
}
