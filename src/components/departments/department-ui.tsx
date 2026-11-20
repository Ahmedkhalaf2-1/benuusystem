import Link from "next/link";
import { CalendarDays, CircleCheck, Factory, Info, PackageCheck, Truck } from "lucide-react";
import { dueText } from "@/components/ds/date-stamp";
import { ProductionTrack } from "@/components/ds/production-track";
import { StatusBadge } from "@/components/orders/status-badge";
import { formatDateAr, formatDateTimeAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { WORK_STATUS_LABELS, type ItemWorkStatus } from "@/lib/departments/labels";
import type { ShareStatus } from "@/lib/finance/allocation";
import type { CollectionHistoryRow, DepartmentActivity, DepartmentMoney, DepartmentOrderRow, DepartmentStats } from "@/server/services/department-service";

/** Department screens: built only from department-scoped DTOs (never whole-order data). */

const WORK_TONE: Record<ItemWorkStatus, string> = {
  NOT_STARTED: "bg-well text-graphite ring-1 ring-hairline",
  IN_PRODUCTION: "bg-violet-soft text-violet",
  READY: "bg-success-soft text-success-ink",
  DELIVERED: "bg-well text-ink ring-1 ring-hairline",
  CANCELLED: "bg-danger-soft text-danger-ink",
};

export function WorkStatusChip({ status }: { status: ItemWorkStatus }) {
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold", WORK_TONE[status])}>{WORK_STATUS_LABELS[status]}</span>;
}

/** The stage panel: orders and pieces of this department, from real records. */
export function DepartmentStatsPanel({ name, stats, eyebrow }: { name: string; stats: DepartmentStats; eyebrow?: string }) {
  const tiles = [
    { n: stats.orders.total, label: "أوردر فيه شغل للقسم" },
    { n: stats.orders.active, label: "شغّال" },
    { n: stats.orders.completed, label: "مكتمل" },
  ];
  return (
    <section className="stage animate-settle relative overflow-hidden rounded-2xl p-5 text-on-panel sm:p-6" aria-labelledby="dept-title">
      <div className="relative">
        {eyebrow && <p className="text-sm text-on-panel-muted">{eyebrow}</p>}
        <h1 id="dept-title" className="mt-1 font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
          {name}
        </h1>
        <ul className="mt-5 grid grid-cols-3 gap-2">
          {tiles.map((t) => (
            <li key={t.label} className="flex flex-col rounded-2xl bg-panel-2 px-3 py-3 ring-1 ring-panel-line">
              <span className="tabular font-display text-[1.9rem] leading-none font-semibold">{formatNumber(t.n)}</span>
              <span className="mt-1.5 text-xs leading-tight text-on-panel-muted">{t.label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-panel-2 px-3 text-on-panel-muted ring-1 ring-panel-line">
            <Factory className="size-3.5" aria-hidden="true" />
            لسه محتاج يخلص <b className="tabular font-semibold text-white">{formatNumber(stats.pendingPieces)}</b> قطعة
          </span>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-panel-2 px-3 text-on-panel-muted ring-1 ring-panel-line">
            <PackageCheck className="size-3.5" aria-hidden="true" />
            جاهز ومستني تسليم <b className="tabular font-semibold text-white">{formatNumber(stats.readyNotDelivered)}</b>
          </span>
          {stats.orders.cancelled > 0 && (
            <span className="inline-flex h-8 items-center rounded-full bg-panel-2 px-3 text-on-panel-muted ring-1 ring-panel-line">ملغي {formatNumber(stats.orders.cancelled)}</span>
          )}
        </div>
      </div>
    </section>
  );
}

/** Item work statuses as a compact row of counts. */
export function WorkStatusSummary({ stats }: { stats: DepartmentStats }) {
  const order: ItemWorkStatus[] = ["NOT_STARTED", "IN_PRODUCTION", "READY", "DELIVERED", "CANCELLED"];
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="حالة البنود">
      {order.map((s) => (
        <li key={s} className="flex items-center justify-between gap-2 rounded-xl bg-well px-3 py-2.5 text-sm">
          <WorkStatusChip status={s} />
          <span className="tabular font-display font-semibold">{formatNumber(stats.items.byStatus[s])}</span>
        </li>
      ))}
    </ul>
  );
}

const PAY_STATUS: Record<ShareStatus, { label: string; tone: string }> = {
  PAID: { label: "متحصّل بالكامل", tone: "bg-success-soft text-success-ink" },
  PARTIAL: { label: "متحصّل جزء", tone: "bg-warning-soft text-warning-ink" },
  UNPAID: { label: "لسه متحصّلش", tone: "bg-well text-graphite ring-1 ring-hairline" },
};

export function PayStatusChip({ status }: { status: ShareStatus }) {
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold", PAY_STATUS[status].tone)}>{PAY_STATUS[status].label}</span>;
}

/**
 * Department money: the value of its work, and — with the collections switch —
 * its ALLOCATED share of customer payments (pro-rata, derived). Never a
 * payment to a partner; partner settlements are shown separately.
 */
export function DepartmentMoneyPanel({ money }: { money: DepartmentMoney }) {
  const c = money.collections;
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-hairline rounded-2xl bg-well px-4">
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-sm text-graphite">قيمة شغل القسم</dt>
          <dd className="tabular font-display text-xl font-semibold" data-testid="dept-work-value">
            {formatMoneyString(money.workValue)}
          </dd>
        </div>
        {c && (
          <>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-sm text-graphite">تحصيل موزّع على القسم</dt>
              <dd className="tabular font-semibold text-success-ink" data-testid="dept-collected">{formatMoneyString(c.collected)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-sm text-graphite">متبقي على العملاء (نصيب القسم)</dt>
              <dd className="tabular font-semibold" data-testid="dept-outstanding">{formatMoneyString(c.outstanding)}</dd>
            </div>
            <div className="flex flex-wrap gap-1.5 py-2.5 text-xs">
              <span className="text-graphite">الأوردرات:</span>
              <span>متحصّل بالكامل <b className="tabular">{formatNumber(c.orders.PAID)}</b></span>·
              <span>جزء <b className="tabular">{formatNumber(c.orders.PARTIAL)}</b></span>·
              <span>لسه <b className="tabular">{formatNumber(c.orders.UNPAID)}</b></span>
            </div>
          </>
        )}
        {money.unreliableItems > 0 && (
          <div className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
            <dt className="text-graphite">بنود مش ممكن توزيع قيمتها بدقة (غير موزّع)</dt>
            <dd className="tabular font-semibold">{formatNumber(money.unreliableItems)}</dd>
          </div>
        )}
      </dl>
      <p className="flex items-start gap-2 rounded-2xl border border-line p-3 text-xs leading-relaxed text-graphite">
        <Info className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden="true" />
        {c
          ? "التحصيل الموزّع محسوب بالنسبة: كل دفعة من العميل بتتقسم على الأقسام حسب قيمة شغل كل قسم في الأوردر. ده تقسيم حسابي للعرض — مش فلوس اتدفعت للشريك. حساب الشريك (التسوية) منفصل."
          : "دي قيمة الشغل (الكمية × سعر القطعة) — مش فلوس اتحصّلت ولا اتدفعت للشريك."}
      </p>
    </div>
  );
}

/** Allocated collections, newest first (department share of each customer payment — never the payment itself). */
export function CollectionHistoryList({ rows, hrefFor }: { rows: CollectionHistoryRow[]; hrefFor?: (orderId: string) => string }) {
  if (rows.length === 0) return <p className="rounded-2xl bg-well p-4 text-sm text-graphite">لسه مفيش تحصيل موزّع على القسم.</p>;
  return (
    <ul className="divide-y divide-hairline">
      {rows.map((r, i) => {
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {r.orderTitle}{" "}
                <span dir="ltr" className="tabular text-xs text-graphite">
                  {formatOrderNumber(r.orderNumber)}
                </span>
              </span>
              <span className="block text-xs text-graphite">
                {formatDateAr(r.paidAt)}
                {r.isAdvance && " · مقدم"}
              </span>
            </span>
            <span className="tabular shrink-0 font-semibold text-success-ink">{formatMoneyString(r.amount)}</span>
          </>
        );
        return (
          <li key={`${r.orderId}-${r.paidAt}-${i}`}>
            {hrefFor ? (
              <Link href={hrefFor(r.orderId)} className="flex min-h-12 items-center gap-3 py-2 text-sm hover:text-violet">
                {body}
              </Link>
            ) : (
              <div className="flex min-h-12 items-center gap-3 py-2 text-sm">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One order on a department list: header + THIS department's items only. */
export function DepartmentOrderCard({ row, href }: { row: DepartmentOrderRow; href: string }) {
  const open = row.orderStatus === "NEW" || row.orderStatus === "IN_PROGRESS";
  const due = dueText(row.deliveryDate);
  const qty = row.items.reduce((s, i) => s + i.quantity, 0);
  const ready = row.items.reduce((s, i) => s + i.ready, 0);
  const delivered = row.items.reduce((s, i) => s + i.delivered, 0);
  return (
    <Link href={href} className={cn("block rounded-2xl border border-line bg-surface p-4 transition-[transform,box-shadow] duration-200 hover:border-line-strong active:scale-[0.985]", row.overdue && "ring-1 ring-red/25")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-[1.02rem] font-semibold">{row.title}</p>
          <p className="truncate text-sm text-graphite">
            {row.customerName}{" "}
            <span dir="ltr" className="tabular text-xs text-graphite/80">
              {formatOrderNumber(row.number)}
            </span>
          </p>
        </div>
        <StatusBadge status={row.orderStatus} overdue={row.overdue} />
      </div>
      <ul className="mt-3 space-y-1.5">
        {row.items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 rounded-xl bg-well px-3 py-2 text-sm">
            <span className="min-w-0 truncate">
              {i.label} <span className="tabular text-graphite">· {formatNumber(i.quantity)} {UNIT_LABELS[row.unit]}</span>
            </span>
            <WorkStatusChip status={i.status} />
          </li>
        ))}
      </ul>
      <ProductionTrack className="mt-3" size="sm" required={qty} ready={ready} delivered={delivered} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="text-graphite">
          جاهز <b className="tabular">{formatNumber(ready)}</b> · اتسلم <b className="tabular">{formatNumber(delivered)}</b> من {formatNumber(qty)}
        </span>
        <span className={cn("inline-flex items-center gap-1 font-semibold", !open ? "text-graphite" : due.tone === "late" ? "text-red" : due.tone === "today" || due.tone === "soon" ? "text-amber-ink" : "text-graphite")}>
          <CalendarDays className="size-3.5" aria-hidden="true" />
          {open ? due.text : formatDateAr(row.deliveryDate)}
        </span>
      </div>
      {row.money && (
        <div className="mt-2 space-y-1 rounded-xl bg-well px-3 py-2 text-sm">
          <p className="flex items-baseline justify-between">
            <span className="text-graphite">قيمة شغل القسم في الأوردر</span>
            <span className="tabular font-semibold">{formatMoneyString(row.money.value)}</span>
          </p>
          {row.money.status && row.money.collected && (
            <p className="flex items-center justify-between gap-2">
              <PayStatusChip status={row.money.status} />
              <span className="tabular text-xs text-graphite">متحصّل {formatMoneyString(row.money.collected)}</span>
            </p>
          )}
        </div>
      )}
    </Link>
  );
}

const ACTIVITY: Record<DepartmentActivity["kind"], { label: string; icon: typeof Factory }> = {
  STAGE: { label: "اتسجل إنتاج", icon: Factory },
  READY: { label: "بقى جاهز", icon: CircleCheck },
  DELIVERY: { label: "اتسلم للعميل", icon: Truck },
};

export function DepartmentActivityList({ items, hrefFor }: { items: DepartmentActivity[]; hrefFor: (orderId: string) => string }) {
  if (items.length === 0) return <p className="rounded-2xl bg-well p-4 text-sm text-graphite">لسه مفيش شغل متسجل على بنود القسم.</p>;
  return (
    <ul className="divide-y divide-hairline">
      {items.map((a, i) => {
        const { label, icon: Icon } = ACTIVITY[a.kind];
        return (
          <li key={`${a.kind}-${i}`}>
            <Link href={hrefFor(a.orderId)} className="flex min-h-12 items-center gap-3 py-2.5 text-sm hover:text-violet">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-soft text-violet">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {label} <b className="tabular">{formatNumber(a.quantity)}</b> — {a.itemLabel}{" "}
                  <span dir="ltr" className="tabular text-xs text-graphite">
                    {formatOrderNumber(a.orderNumber)}
                  </span>
                </span>
                <span className="block text-xs text-graphite">{formatDateTimeAr(a.at)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
