import type { OrderVisibility } from "@/generated/prisma/enums";

/** «ظهور الأوردر للعمال» — shared by server and client. */
export const ORDER_VISIBILITIES = ["PRIVATE", "ALL_AUTHORIZED_STAFF", "SELECTED_STAFF"] as const satisfies readonly OrderVisibility[];

export const VISIBILITY_LABELS: Record<OrderVisibility, string> = {
  PRIVATE: "خاص بالمدير فقط",
  ALL_AUTHORIZED_STAFF: "ظاهر لكل العاملين المصرح لهم",
  SELECTED_STAFF: "عمال محددون فقط",
};

export const VISIBILITY_HINTS: Record<OrderVisibility, string> = {
  PRIVATE: "محدش من الموظفين يشوفه.",
  ALL_AUTHORIZED_STAFF: "أي موظف عنده صلاحية «عرض الأوردرات» يشوفه.",
  SELECTED_STAFF: "بس الحسابات اللي هتختارها تحت.",
};

/** An app login account (never a payroll worker) that an order can be shared with. */
export type AssignableStaff = { id: string; name: string; email: string; canViewOrders: boolean };

export type OrderAccessValue = { visibility: OrderVisibility; userIds: string[] };
