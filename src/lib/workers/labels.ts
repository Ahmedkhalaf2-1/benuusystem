import type { WorkerJob, WorkerPaymentType, WorkType, WorkUnit } from "@/generated/prisma/enums";

/** Arabic wording for the workers module. Safe for client and server. */

export const WORKER_JOBS: readonly WorkerJob[] = [
  "DTF_PRINTING",
  "EMBROIDERY",
  "SCREEN_PRINTING",
  "GARMENT_MAKING",
  "FINISHING_PACKING",
  "OTHER",
];

export const WORKER_JOB_LABELS: Record<WorkerJob, string> = {
  DTF_PRINTING: "طباعة DTF",
  EMBROIDERY: "تطريز",
  SCREEN_PRINTING: "سلك سكرين",
  GARMENT_MAKING: "تصنيع ملابس",
  FINISHING_PACKING: "تشطيب وتغليف",
  OTHER: "أخرى",
};

export function jobLabel(job: WorkerJob, jobTitle?: string | null): string {
  return jobTitle?.trim() || WORKER_JOB_LABELS[job];
}

export const WORK_UNITS: readonly WorkUnit[] = ["PIECE", "PRINT", "METER", "PRESS", "COVER"];

export const WORK_UNIT_LABELS: Record<WorkUnit, string> = {
  PIECE: "قطعة",
  PRINT: "طبعة",
  METER: "متر",
  PRESS: "كبسة",
  COVER: "كفر",
};

export const WORK_TYPES: readonly WorkType[] = [
  "DTF",
  "SCREEN_PRINT",
  "EMBROIDERY",
  "CUTTING",
  "SEWING",
  "FINISHING",
  "PACKING",
  "OTHER",
];

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  DTF: "طباعة DTF",
  SCREEN_PRINT: "سلك سكرين",
  EMBROIDERY: "تطريز",
  CUTTING: "قص",
  SEWING: "خياطة",
  FINISHING: "تشطيب",
  PACKING: "تغليف",
  OTHER: "أخرى",
};

/** Sensible first guesses from the worker's job (the user can change them). */
export const JOB_DEFAULTS: Record<WorkerJob, { workType: WorkType; unit: WorkUnit }> = {
  DTF_PRINTING: { workType: "DTF", unit: "PRINT" },
  EMBROIDERY: { workType: "EMBROIDERY", unit: "PIECE" },
  SCREEN_PRINTING: { workType: "SCREEN_PRINT", unit: "PRINT" },
  GARMENT_MAKING: { workType: "SEWING", unit: "PIECE" },
  FINISHING_PACKING: { workType: "PACKING", unit: "PIECE" },
  OTHER: { workType: "OTHER", unit: "PIECE" },
};

export const WORKER_PAYMENT_TYPE_LABELS: Record<WorkerPaymentType, string> = {
  WAGE: "يومية / مستحقات",
  ADVANCE: "سلفة",
};
