import Link from "next/link";
import { AlarmClock, CalendarClock, CalendarDays, Package, PackageCheck, Shirt, Smartphone, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/orders/status-badge";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, UNIT_LABELS } from "@/lib/orders/labels";
import { isClothingProduct } from "@/lib/orders/sizes";
import { cn } from "@/lib/utils";
import type { OrderSummary } from "@/server/services/order-dto";
import { dueText } from "./date-stamp";
import { ProductionTrack } from "./production-track";

/** The product's own glyph — a garment, a phone case, or a parcel for anything else. */
export function ProductIcon({ productType, className, strokeWidth = 1.8 }: { productType: string; className?: string; strokeWidth?: number }) {
  const props = { className, strokeWidth, "aria-hidden": true as const };
  if (/جراب|كفر|موبايل/.test(productType)) return <Smartphone {...props} />;
  if (isClothingProduct(productType)) return <Shirt {...props} />;
  return <Package {...props} />;
}

function DueChip({ order }: { order: OrderSummary }) {
  const open = order.status === "NEW" || order.status === "IN_PROGRESS";
  if (!open) return null;
  const due = dueText(order.deliveryDate);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold",
        due.tone === "late" ? "text-red" : due.tone === "today" || due.tone === "soon" ? "text-amber-ink" : "text-graphite",
      )}
    >
      <CalendarDays className="size-3.5" aria-hidden="true" />
      {due.text}
    </span>
  );
}

/** A recent order: product, who and what, status, deadline and how far it has come. */
export function OrderCard({ order, showMoney }: { order: OrderSummary; showMoney?: boolean }) {
  const prod = order.production ?? { ready: 0, delivered: 0 };
  return (
    <li className="min-w-0">
      <Link
        href={`/orders/${order.id}`}
        className="group block h-full rounded-2xl bg-surface p-4 border border-line transition-[transform,box-shadow] duration-200 ease-[var(--ease-out-expo)] hover:border-line-strong active:scale-[0.985]"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-well text-violet">
            <ProductIcon productType={order.productType} className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-display text-[1.02rem] font-semibold">{order.customerName}</p>
              <StatusBadge status={order.status} overdue={order.overdue} />
            </div>
            <p className="truncate text-sm text-graphite">
              {order.title} <span dir="ltr" className="tabular text-xs text-graphite/80">{formatOrderNumber(order.number)}</span>
            </p>
          </div>
        </div>
        <ProductionTrack className="mt-3.5" size="md" required={order.quantity} ready={prod.ready} delivered={prod.delivered} />
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-graphite">
            اتسلم <b className="tabular font-display text-sm font-semibold text-ink">{formatNumber(prod.delivered)}</b> من {formatNumber(order.quantity)} {UNIT_LABELS[order.unit]}
          </span>
          <span className="flex items-center gap-3">
            {showMoney && <span className="tabular font-semibold text-ink">{formatMoneyString(order.totalPrice)}</span>}
            <DueChip order={order} />
          </span>
        </div>
      </Link>
    </li>
  );
}

export type AttentionKind = "late" | "soon" | "ready";

const ATTENTION: Record<AttentionKind, { icon: LucideIcon; tone: string; ring: string }> = {
  late: { icon: AlarmClock, tone: "bg-danger-soft text-danger-ink", ring: "ring-red/20" },
  soon: { icon: CalendarClock, tone: "bg-warning-soft text-warning-ink", ring: "ring-amber/25" },
  ready: { icon: PackageCheck, tone: "bg-brand-soft text-brand-ink", ring: "ring-teal/20" },
};

/** One job that needs someone today, with the reason up front. */
export function AttentionCard({ order, kind }: { order: OrderSummary; kind: AttentionKind }) {
  const prod = order.production ?? { ready: 0, delivered: 0 };
  const waiting = prod.ready - prod.delivered;
  const due = dueText(order.deliveryDate);
  const { icon: Icon, tone, ring } = ATTENTION[kind];
  const reason = kind === "ready" ? `${formatNumber(waiting)} ${UNIT_LABELS[order.unit]} جاهزة تستنى التسليم` : due.text;
  return (
    <li className="w-[78%] shrink-0 snap-start sm:w-auto">
      <Link
        href={`/orders/${order.id}`}
        className={cn(
          "flex h-full flex-col rounded-2xl bg-surface p-4 border border-line ring-1 transition-[transform,box-shadow] duration-200 hover:border-line-strong active:scale-[0.985]",
          ring,
        )}
      >
        <span className={cn("inline-flex w-fit max-w-full items-start gap-1.5 rounded-2xl px-2.5 py-1 text-xs leading-snug font-semibold", tone)}>
          <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{reason}</span>
        </span>
        <p className="mt-3 truncate font-display text-[1.05rem] font-semibold">{order.customerName}</p>
        <p className="truncate text-sm text-graphite">{order.title}</p>
        <div className="mt-auto pt-4">
          <ProductionTrack size="sm" required={order.quantity} ready={prod.ready} delivered={prod.delivered} />
          <p className="mt-1.5 text-xs text-graphite">
            جاهز <b className="tabular text-ink">{formatNumber(prod.ready)}</b> · اتسلم <b className="tabular text-ink">{formatNumber(prod.delivered)}</b> من{" "}
            {formatNumber(order.quantity)}
          </p>
        </div>
      </Link>
    </li>
  );
}
