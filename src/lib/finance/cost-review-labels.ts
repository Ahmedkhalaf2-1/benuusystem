import type { CostReviewStatus } from "@/generated/prisma/enums";

/** LEGACY = an order created before cost tracking that was never reviewed. */
export const COST_STATUS_LABELS: Record<CostReviewStatus | "LEGACY", string> = {
  LEGACY: "قديم — تكاليفه محتاجة مراجعة",
  PENDING: "مستني مراجعة التكاليف",
  IN_PROGRESS: "التكاليف بتتسجل",
  CLOSED: "التكاليف مقفولة",
  NEEDS_REVIEW: "محتاج مراجعة بعد تعديل الأوردر",
};
