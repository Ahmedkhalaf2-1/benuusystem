import { SETTLEMENT_LABELS, type SettlementStatus } from "@/lib/finance/labels";
import { cn } from "@/lib/utils";

const TONES: Record<SettlementStatus, string> = {
  PAID: "bg-emerald-50 text-emerald-800",
  PARTIAL: "bg-amber-50 text-amber-800",
  UNPAID: "bg-destructive/10 text-destructive",
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
