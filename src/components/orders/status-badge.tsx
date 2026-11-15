import type { OrderStatus } from "@/generated/prisma/enums";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";

/**
 * Status pills. Colour follows meaning, and the word always carries it too:
 * new = neutral, in progress = sapphire (work happening), completed = green,
 * cancelled = muted and struck through, overdue = red.
 */
const TONE: Record<OrderStatus, string> = {
  NEW: "bg-muted text-ink ring-1 ring-line",
  IN_PROGRESS: "bg-brand-soft text-brand-ink",
  COMPLETED: "bg-success-soft text-success-ink",
  CANCELLED: "bg-muted text-graphite line-through",
};
const DOT: Record<OrderStatus, string> = { NEW: "bg-graphite", IN_PROGRESS: "bg-brand-solid", COMPLETED: "bg-success", CANCELLED: "bg-graphite" };

function Pill({ tone, dot, children }: { tone: string; dot: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap", tone)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} />
      {children}
    </span>
  );
}

export function StatusBadge({
  status,
  overdue,
  partlyDelivered,
  onDark,
}: {
  status: OrderStatus;
  overdue?: boolean;
  partlyDelivered?: boolean;
  /** On the graphite panel. */
  onDark?: boolean;
}) {
  const onPanel = "bg-panel-2 text-on-panel ring-1 ring-panel-line";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone={onDark ? onPanel : TONE[status]} dot={onDark ? (status === "COMPLETED" ? "bg-panel-success" : "bg-on-panel-muted") : DOT[status]}>
        {ORDER_STATUS_LABELS[status]}
      </Pill>
      {partlyDelivered && (
        <Pill tone={onDark ? onPanel : "bg-muted text-ink ring-1 ring-line"} dot={onDark ? "bg-brand" : "bg-brand-solid"}>
          تم تسليم جزء
        </Pill>
      )}
      {overdue && (
        <Pill tone={onDark ? "bg-panel-2 text-panel-danger ring-1 ring-panel-line" : "bg-danger-soft text-danger-ink"} dot={onDark ? "bg-panel-danger" : "bg-danger"}>
          متأخر
        </Pill>
      )}
    </span>
  );
}
