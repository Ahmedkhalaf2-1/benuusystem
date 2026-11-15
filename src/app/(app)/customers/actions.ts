"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { createCustomer, updateCustomer } from "@/server/services/customer-service";

function customerFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function saveCustomerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const customerId = String(formData.get("customerId") ?? "");
  let id = customerId;
  const failure = await toActionResult(async () => {
    if (customerId) {
      await updateCustomer(prisma, user, customerId, customerFields(formData));
    } else {
      id = (await createCustomer(prisma, user, customerFields(formData))).id;
    }
  });
  if (failure) return failure;
  redirect(`/customers/${id}?saved=${customerId ? "updated" : "created"}`);
}
