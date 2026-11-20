import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { assertPermission, hasPermission, isOwner } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * «منتجات جاهزة»: the shortcut names offered for ready-made items in the
 * order form. Names only — no catalog, price or stock (inventory is out of
 * scope). The owner manages the list; any other name can still be typed.
 */

const nameSchema = z.string({ error: "اكتب اسم المنتج" }).trim().min(1, "اكتب اسم المنتج").max(80, "الاسم طويل جدًا");

function bad(field: string, message: string): never {
  throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [field]: [message] } });
}

function requireOwner(actor: Actor) {
  assertPermission(actor, "users:manage");
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
}

/** Active preset names for the order form. */
export async function listActivePresetNames(db: DbClient, actor: Actor): Promise<string[]> {
  if (!hasPermission(actor, "orders:create") && !hasPermission(actor, "orders:edit")) throw new AppError("FORBIDDEN");
  const rows = await db.productPreset.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true } });
  return rows.map((r) => r.name);
}

export async function listPresetsForAdmin(db: DbClient, actor: Actor) {
  requireOwner(actor);
  return db.productPreset.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true, sortOrder: true } });
}

export async function createPreset(db: PrismaClient, actor: Actor, payload: { name: unknown }) {
  requireOwner(actor);
  const parsed = nameSchema.safeParse(payload.name);
  if (!parsed.success) bad("name", parsed.error.issues[0]!.message);
  const name = parsed.data;
  return db.$transaction(async (tx) => {
    if (await tx.productPreset.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } })) bad("name", "المنتج ده موجود في القايمة");
    const last = await tx.productPreset.aggregate({ _max: { sortOrder: true } });
    const preset = await tx.productPreset.create({ data: { name, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: actor.id }, select: { id: true } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.PRODUCT_PRESET_CREATED, entityType: "ProductPreset", entityId: preset.id, metadata: { name } });
    return { presetId: preset.id };
  });
}

/** Rename, switch on/off, or move up/down («move»: -1 / +1). */
export async function updatePreset(db: PrismaClient, actor: Actor, payload: { presetId: unknown; name?: unknown; isActive?: unknown; move?: unknown }) {
  requireOwner(actor);
  const id = z.uuid().safeParse(payload.presetId);
  if (!id.success) throw new AppError("NOT_FOUND", "المنتج مش موجود");
  return db.$transaction(async (tx) => {
    const all = await tx.productPreset.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true, sortOrder: true } });
    const index = all.findIndex((p) => p.id === id.data);
    if (index < 0) throw new AppError("NOT_FOUND", "المنتج مش موجود");
    const before = all[index]!;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (payload.name !== undefined) {
      const parsed = nameSchema.safeParse(payload.name);
      if (!parsed.success) bad("name", parsed.error.issues[0]!.message);
      if (parsed.data !== before.name) {
        if (all.some((p) => p.id !== before.id && p.name.toLowerCase() === parsed.data.toLowerCase())) bad("name", "المنتج ده موجود في القايمة");
        await tx.productPreset.update({ where: { id: before.id }, data: { name: parsed.data } });
        changes.name = { from: before.name, to: parsed.data };
      }
    }
    if (payload.isActive !== undefined) {
      if (typeof payload.isActive !== "boolean") bad("isActive", "قيمة غير صحيحة");
      if (payload.isActive !== before.isActive) {
        await tx.productPreset.update({ where: { id: before.id }, data: { isActive: payload.isActive } });
        changes.isActive = { from: before.isActive, to: payload.isActive };
      }
    }
    if (payload.move === -1 || payload.move === 1) {
      const other = all[index + (payload.move as number)];
      if (other) {
        // Renumber the whole list so the swap is unambiguous even with equal sort numbers.
        const order = all.map((p) => p.id);
        [order[index], order[index + (payload.move as number)]] = [order[index + (payload.move as number)]!, order[index]!];
        for (const [i, pid] of order.entries()) await tx.productPreset.update({ where: { id: pid }, data: { sortOrder: i + 1 } });
        changes.position = { from: index + 1, to: index + 1 + (payload.move as number) };
      }
    }
    if (Object.keys(changes).length === 0) return { changed: false };
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.PRODUCT_PRESET_UPDATED, entityType: "ProductPreset", entityId: before.id, metadata: { changes } as Prisma.InputJsonValue });
    return { changed: true };
  });
}
