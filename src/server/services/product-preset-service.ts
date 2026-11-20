import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { assertPermission, hasPermission, isOwner } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { cmToMm, isWorkKind, WORK_KIND_CONFIG, type WorkKind } from "@/lib/orders/work-kinds";

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

// ───────────────────────────── Work-kind settings (roll widths) ─────────────────────────────

/** Default roll width (mm) per linear-meter work kind; only what the owner configured. */
export async function getRollWidths(db: DbClient): Promise<Partial<Record<WorkKind, number>>> {
  const rows = await db.workKindSetting.findMany({ where: { rollWidthMm: { not: null } }, select: { workKind: true, rollWidthMm: true } });
  return Object.fromEntries(rows.filter((r) => isWorkKind(r.workKind)).map((r) => [r.workKind, r.rollWidthMm!]));
}

/** Owner: set (or clear with "") the default roll width of a linear-meter work kind, in cm. Audited. */
export async function setRollWidth(db: PrismaClient, actor: Actor, payload: { workKind: unknown; rollWidthCm: unknown }) {
  requireOwner(actor);
  const kind = payload.workKind;
  if (!isWorkKind(kind) || WORK_KIND_CONFIG[kind].pricing !== "LINEAR_METER") throw new AppError("VALIDATION_ERROR", "نوع الشغل ده مالوش عرض رول");
  const text = typeof payload.rollWidthCm === "string" ? payload.rollWidthCm.trim() : "";
  const mm = text === "" ? null : cmToMm(text);
  if (text !== "" && (mm === null || mm <= 0 || mm > 10_000)) bad("rollWidthCm", "اكتب عرض الرول بالسم، مثال: 60");
  return db.$transaction(async (tx) => {
    const before = await tx.workKindSetting.findUnique({ where: { workKind: kind }, select: { rollWidthMm: true } });
    if ((before?.rollWidthMm ?? null) === mm) return { changed: false };
    await tx.workKindSetting.upsert({ where: { workKind: kind }, create: { workKind: kind, rollWidthMm: mm, updatedById: actor.id }, update: { rollWidthMm: mm, updatedById: actor.id } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.WORK_KIND_SETTING_UPDATED, entityType: "WorkKindSetting", entityId: kind, metadata: { rollWidthMm: { from: before?.rollWidthMm ?? null, to: mm } } });
    return { changed: true };
  });
}
