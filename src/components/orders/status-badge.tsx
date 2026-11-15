import type { OrderStatus } from "@/generated/prisma/enums";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";

const TONES: Record<OrderStatus, string> = {
  NEW: "bg-brand-soft text-primary",
  IN_PROGRESS: "bg-amber-50 text-amber-800",
  COMPLETED: "bg-emerald-50 text-emerald-800",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

export function StatusBadge({ status, overdue, partlyDelivered }: { status: OrderStatus; overdue?: boolean; partlyDelivered?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", TONES[status])}>
        {ORDER_STATUS_LABELS[status]}
      </span>
      {partlyDelivered && (
        <span className="inline-flex h-6 items-center rounded-full bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800">تم تسليم جزء</span>
      )}
      {overdue && (
        <span className="inline-flex h-6 items-center rounded-full bg-destructive/10 px-2.5 text-xs font-semibold text-destructive">
          متأخر
        </span>
      )}
    </span>
  );
}
