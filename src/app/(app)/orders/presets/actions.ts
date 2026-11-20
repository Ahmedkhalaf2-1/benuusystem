"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { createPreset, updatePreset } from "@/server/services/product-preset-service";

/** Owner: «منتجات جاهزة» list. The service re-checks owner rights. */
export async function createPresetAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => createPreset(prisma, user, { name: formData.get("name") }));
  if (failure) return failure;
  redirect("/orders/presets?saved=created");
}

export async function updatePresetAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const active = formData.get("isActive");
  const move = formData.get("move");
  const failure = await toActionResult(() =>
    updatePreset(prisma, user, {
      presetId: formData.get("presetId"),
      ...(formData.has("name") ? { name: formData.get("name") } : {}),
      ...(active === "yes" || active === "no" ? { isActive: active === "yes" } : {}),
      ...(move === "-1" || move === "1" ? { move: Number(move) } : {}),
    }),
  );
  if (failure) return failure;
  redirect("/orders/presets?saved=updated");
}
