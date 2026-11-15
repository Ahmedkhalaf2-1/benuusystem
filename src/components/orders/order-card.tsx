import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { formatDateAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import type { OrderSummary } from "@/server/services/order-dto";
import { StatusBadge } from "./status-badge";

/** Mobile order card: who, what, how many, money, when. */
export function OrderCard({ order, hideCustomer, showMoney = true }: { order: OrderSummary; hideCustomer?: boolean; showMoney?: boolean }) {
  const settled = order.outstanding === "0.00";
  const prod = order.production;
  const pct = (v: number) => `${order.quantity > 0 ? Math.min(100, (v / order.quantity) * 100) : 0}%`;
  return (
    <Link
      href={`/orders/${order.id}`}
      className={cn(
        "block rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 active:bg-muted",
        order.overdue && "border-destructive/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground" dir="ltr">
            {formatOrderNumber(order.number)}
          </p>
          <p className="mt-0.5 truncate font-bold">
            {hideCustomer ? order.title : `${order.customerName} — ${order.title}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatNumber(order.quantity)} {UNIT_LABELS[order.unit]} · {order.productType}
          </p>
        </div>
        <StatusBadge status={order.status} overdue={order.overdue} partlyDelivered={!!prod && prod.delivered > 0 && order.status !== "COMPLETED"} />
      </div>

      {prod && (
        <div className="mt-3">
          <p className="text-sm">
            جاهز <b>{formatNumber(prod.ready)}</b> · اتسلم <b>{formatNumber(prod.delivered)}</b> من {formatNumber(order.quantity)} {UNIT_LABELS[order.unit]}
            {order.quantity - prod.ready > 0 && <span className="text-muted-foreground"> · باقي {formatNumber(order.quantity - prod.ready)}</span>}
          </p>
          <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div className="absolute inset-y-0 start-0 bg-primary/30" style={{ width: pct(prod.ready) }} />
            <div className="absolute inset-y-0 start-0 bg-primary" style={{ width: pct(prod.delivered) }} />
          </div>
        </div>
      )}

      {showMoney && <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-2.5 text-center">
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">الإجمالي</dt>
          <dd className="whitespace-nowrap text-sm font-bold">{formatMoneyString(order.totalPrice)}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">المدفوع</dt>
          <dd className="whitespace-nowrap text-sm font-bold text-emerald-700">{formatMoneyString(order.paid)}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">المتبقي</dt>
          <dd className={cn("whitespace-nowrap text-sm font-bold", settled ? "text-muted-foreground" : "text-primary")}>
            {formatMoneyString(order.outstanding)}
          </dd>
        </div>
      </dl>}

      <p className={cn("mt-3 flex items-center gap-1.5 text-sm", order.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
        <CalendarClock className="size-4" aria-hidden="true" />
        موعد التسليم: {formatDateAr(order.deliveryDate)}
      </p>
    </Link>
  );
}
