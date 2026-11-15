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
export function OrderCard({ order, hideCustomer }: { order: OrderSummary; hideCustomer?: boolean }) {
  const settled = order.outstanding === "0.00";
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
        <StatusBadge status={order.status} overdue={order.overdue} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-2.5 text-center">
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
      </dl>

      <p className={cn("mt-3 flex items-center gap-1.5 text-sm", order.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
        <CalendarClock className="size-4" aria-hidden="true" />
        موعد التسليم: {formatDateAr(order.deliveryDate)}
      </p>
    </Link>
  );
}
