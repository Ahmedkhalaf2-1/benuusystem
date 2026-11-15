import type { CostCategory, ExpenseCategory } from "@/generated/prisma/enums";

/** Arabic wording for costs & expenses. Safe for client and server. */

export const COST_CATEGORIES: readonly CostCategory[] = [
  "MATERIALS",
  "PRINTING",
  "EMBROIDERY",
  "OUTSOURCED_LABOR",
  "TRANSPORT",
  "PACKAGING",
  "OTHER",
];

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  MATERIALS: "قماش وخامات",
  PRINTING: "طباعة",
  EMBROIDERY: "تطريز",
  OUTSOURCED_LABOR: "مصنعية خارجية",
  TRANSPORT: "نقل",
  PACKAGING: "تغليف",
  OTHER: "أخرى",
};

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  "RENT",
  "ELECTRICITY",
  "WATER",
  "INTERNET",
  "MAINTENANCE",
  "TRANSPORT",
  "CLEANING",
  "SUPPLIES",
  "ADMINISTRATIVE",
  "OTHER",
];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: "إيجار",
  ELECTRICITY: "كهرباء",
  WATER: "مياه",
  INTERNET: "إنترنت",
  MAINTENANCE: "صيانة",
  TRANSPORT: "نقل عام",
  CLEANING: "نظافة",
  SUPPLIES: "مستلزمات",
  ADMINISTRATIVE: "مصاريف إدارية",
  OTHER: "أخرى",
};

/** How the user says what they paid when recording a cost/expense. */
export const PAY_STATUSES = ["FULL", "PARTIAL", "CREDIT"] as const;
export type PayStatus = (typeof PAY_STATUSES)[number];

export const PAY_STATUS_LABELS: Record<PayStatus, string> = {
  FULL: "مدفوع بالكامل",
  PARTIAL: "مدفوع جزء",
  CREDIT: "آجل — لسه متدفعش",
};

/** Derived (never stored) status of a cost/expense from its payments. */
export type SettlementStatus = "PAID" | "PARTIAL" | "UNPAID";
export const SETTLEMENT_LABELS: Record<SettlementStatus, string> = {
  PAID: "مدفوع بالكامل",
  PARTIAL: "مدفوع جزء",
  UNPAID: "لسه متدفعش",
};

export function settlementStatus(amount: bigint, paid: bigint): SettlementStatus {
  if (paid <= 0n) return "UNPAID";
  if (paid >= amount) return "PAID";
  return "PARTIAL";
}
