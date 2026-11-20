import type { PrintOperation } from "@/generated/prisma/enums";
import { PRINT_OPERATIONS } from "@/lib/orders/labels";
import { isWorkKind, WORK_KIND_CONFIG } from "@/lib/orders/work-kinds";

/**
 * Codes of the seeded departments. Departments live in a table (the owner can
 * add, rename or deactivate them); these codes are only used to SUGGEST a
 * department from an item's work — the person can always pick another.
 */
export const DEPARTMENT_KEYS = ["EMBROIDERY", "COVERS", "PRINTING", "GARMENTS"] as const;
export type DepartmentKey = (typeof DEPARTMENT_KEYS)[number];

const COVERS_WORDS = /(جراب|كوفر|cover)/i;

/**
 * The department an item most likely belongs to. Same rule as the Phase 2
 * migration backfill (prisma/migrations/*_departments_partners):
 *   1. the item's name (or, unnamed, the order's product type) mentions covers → COVERS
 *   2. its primary work type — the first design's operation, or (older items)
 *      the first item-level operation — EMBROIDERY → EMBROIDERY,
 *      DTF / SCREEN_PRINT → PRINTING, MANUFACTURING or none (ready-made) → GARMENTS
 *
 * An item belongs to ONE department. An item mixing printing and embroidery
 * goes with its primary work; to count it for two departments, split it into
 * two priced items (owner decision — see the architecture plan, 7.1).
 */
export function suggestDepartmentKey(item: {
  name?: string | null;
  productType?: string | null;
  designs?: readonly { operation: PrintOperation | string | null }[];
  operations?: readonly PrintOperation[];
  /** «نوع الشغل»: its configured department wins (src/lib/orders/work-kinds.ts). */
  workKind?: string | null;
}): DepartmentKey {
  if (isWorkKind(item.workKind)) return WORK_KIND_CONFIG[item.workKind].department;
  const label = item.name?.trim() || item.productType?.trim() || "";
  if (COVERS_WORDS.test(label)) return "COVERS";
  const fromDesign = item.designs?.find((d) => d.operation)?.operation as PrintOperation | undefined;
  const primary = fromDesign ?? PRINT_OPERATIONS.find((op) => item.operations?.includes(op));
  if (primary === "EMBROIDERY") return "EMBROIDERY";
  if (primary === "DTF" || primary === "SCREEN_PRINT" || primary === "VINYL" || primary === "SUBLIMATION" || primary === "OTHER_PRINT") return "PRINTING";
  return "GARMENTS";
}

/** True when an item's work spans more than one department (shown as a hint to split it). */
export function spansDepartments(item: { designs?: readonly { operation: PrintOperation | string | null }[]; operations?: readonly PrintOperation[] }): boolean {
  const ops = new Set<string>([...(item.designs ?? []).map((d) => d.operation ?? ""), ...(item.operations ?? [])].filter(Boolean));
  const depts = new Set([...ops].map((op) => (op === "EMBROIDERY" ? "E" : op === "MANUFACTURING" ? "G" : "P")));
  return depts.size > 1;
}

/** A department as offered in forms (names only). */
export type DepartmentOption = { id: string; key: string | null; name: string };

/** The suggested department among the ACTIVE ones offered; null when it isn't offered. */
export function suggestDepartmentId(options: readonly DepartmentOption[], item: Parameters<typeof suggestDepartmentKey>[0]): string | null {
  const key = suggestDepartmentKey(item);
  return options.find((o) => o.key === key)?.id ?? null;
}
