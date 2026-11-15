import type { OrderStatus } from "@/generated/prisma/enums";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";

const TONE: Record<OrderStatus, string> = {
  NEW: "bg-violet-soft text-violet",
  IN_PROGRESS: "bg-blue-soft text-blue-ink",
  COMPLETED: "bg-green-soft text-green-ink",
  CANCELLED: "bg-muted text-graphite line-through",
};
const DOT: Record<OrderStatus, string> = { NEW: "bg-violet", IN_PROGRESS: "bg-blue", COMPLETED: "bg-green", CANCELLED: "bg-graphite" };

function Pill({ tone, dot, children }: { tone: string; dot: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", tone)}>
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
  /** On the violet stage: frosted pills. */
  onDark?: boolean;
}) {
  const frost = "bg-white/15 text-white backdrop-blur";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone={onDark ? frost : TONE[status]} dot={onDark ? "bg-white" : DOT[status]}>
        {ORDER_STATUS_LABELS[status]}
      </Pill>
      {partlyDelivered && (
        <Pill tone={onDark ? frost : "bg-teal-soft text-teal-ink"} dot={onDark ? "bg-[#5eead4]" : "bg-teal"}>
          تم تسليم جزء
        </Pill>
      )}
      {overdue && (
        <Pill tone="bg-red text-white" dot="bg-white">
          متأخر
        </Pill>
      )}
    </span>
  );
}
