import { SETTLEMENT_LABELS, type SettlementStatus } from "@/lib/finance/labels";
import { cn } from "@/lib/utils";

/**
 * Meaning colours (DESIGN.md): paid = green, partly paid = sapphire (in
 * progress), unpaid = amber (needs action). Red is kept for errors/overdue —
 * an unpaid bill is a task, not a fault.
 */
const TONES: Record<SettlementStatus, string> = {
  PAID: "bg-success-soft text-success-ink",
  PARTIAL: "bg-brand-soft text-brand-ink",
  UNPAID: "bg-warning-soft text-warning-ink",
};

export function SettlementBadge({ status, voided }: { status: SettlementStatus; voided?: boolean }) {
  if (voided) {
    return <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-semibold text-muted-foreground">ملغي</span>;
  }
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold", TONES[status])}>
      {SETTLEMENT_LABELS[status]}
    </span>
  );
}
