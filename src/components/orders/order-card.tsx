import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { dueText } from "@/components/ds/date-stamp";
import { ProductIcon } from "@/components/ds/order-cards";
import { ProductionTrack } from "@/components/ds/production-track";
import { formatDateAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import type { OrderSummary } from "@/server/services/order-dto";
import { StatusBadge } from "./status-badge";

/** An order on a list: product, who and what, status, deadline, production, and money for those allowed. */
export function OrderCard({ order, hideCustomer, showMoney = true }: { order: OrderSummary; hideCustomer?: boolean; showMoney?: boolean }) {
  const settled = order.outstanding === "0.00";
  const prod = order.production ?? { ready: 0, delivered: 0 };
  const open = order.status === "NEW" || order.status === "IN_PROGRESS";
  const due = dueText(order.deliveryDate);
  return (
    <Link
      href={`/orders/${order.id}`}
      className={cn(
        "block rounded-2xl bg-surface p-4 border border-line transition-[transform,box-shadow] duration-200 hover:border-line-strong active:scale-[0.985]",
        order.overdue && "ring-1 ring-red/25",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-well text-violet">
          <ProductIcon productType={order.productType} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate font-display text-[1.02rem] font-semibold">{hideCustomer ? order.title : order.customerName}</p>
            <StatusBadge status={order.status} overdue={order.overdue} partlyDelivered={prod.delivered > 0 && order.status !== "COMPLETED"} />
          </div>
          <p className="truncate text-sm text-graphite">
            {hideCustomer ? order.productType : order.title}{" "}
            <span dir="ltr" className="tabular text-xs text-graphite/80">
              {formatOrderNumber(order.number)}
            </span>
          </p>
        </div>
      </div>

      <ProductionTrack className="mt-3.5" required={order.quantity} ready={prod.ready} delivered={prod.delivered} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="text-graphite">
          جاهز <b className="tabular text-teal-ink">{formatNumber(prod.ready)}</b> · اتسلم <b className="tabular font-display text-sm text-ink">{formatNumber(prod.delivered)}</b> من{" "}
          {formatNumber(order.quantity)} {UNIT_LABELS[order.unit]}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 font-semibold",
            !open ? "text-graphite" : due.tone === "late" ? "text-red" : due.tone === "today" || due.tone === "soon" ? "text-amber-ink" : "text-graphite",
          )}
        >
          <CalendarDays className="size-3.5" aria-hidden="true" />
          {open ? due.text : formatDateAr(order.deliveryDate)}
        </span>
      </div>

      {showMoney && (
        <dl className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-well px-1 py-2 text-center">
          <div className="min-w-0">
            <dt className="text-[0.68rem] text-graphite">الإجمالي</dt>
            <dd className="tabular font-display text-sm leading-tight font-semibold">{formatMoneyString(order.totalPrice)}</dd>
          </div>
          <div className="min-w-0 border-x border-hairline">
            <dt className="text-[0.68rem] text-graphite">المدفوع</dt>
            <dd className="tabular font-display text-sm leading-tight font-semibold text-green-ink">{formatMoneyString(order.paid)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.68rem] text-graphite">المتبقي</dt>
            <dd className={cn("tabular font-display text-sm leading-tight font-semibold", settled ? "text-graphite" : "text-violet")}>{formatMoneyString(order.outstanding)}</dd>
          </div>
        </dl>
      )}
    </Link>
  );
}
