import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Factory, Info, Layers } from "lucide-react";
import { PayStatusChip, WorkStatusChip } from "@/components/departments/department-ui";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { ProductionTrack } from "@/components/ds/production-track";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/orders/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, OPERATION_LABELS, placementsText, UNIT_LABELS } from "@/lib/orders/labels";
import { getDepartmentOrder } from "@/server/services/department-service";
import { orNotFound } from "../../../load";

export const metadata: Metadata = { title: "شغل القسم في الأوردر" };

const FLASH: Record<string, string> = {
  stage: "اتسجل الإنتاج ✓",
  "stage-ready": "اتسجل الإنتاج وبقى جاهز ✓",
  ready: "اتسجل الجاهز ✓",
};

/** One order as the department sees it: header + ONLY the department's items. No totals, phones, notes or payments. */
export default async function DepartmentOrderPage(props: PageProps<"/departments/[id]/orders/[orderId]">) {
  const user = await requireUser();
  const { id, orderId } = await props.params;
  const { saved } = await props.searchParams;
  const view = await orNotFound(() => getDepartmentOrder(prisma, user, id, orderId));
  const { order, department } = view;
  const base = `/departments/${department.departmentId}`;
  const u = UNIT_LABELS[order.unit];
  const open = order.status === "NEW" || order.status === "IN_PROGRESS";
  const canRecord = department.canRecordProduction && open && view.items.some((i) => i.ready < i.quantity || i.designs.length > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <FlowHeader
        icon={Layers}
        hue="violet"
        title={order.title}
        backHref={`${base}/orders`}
        backLabel={`أوردرات ${department.name}`}
        context={
          <>
            <span dir="ltr" className="tabular">{formatOrderNumber(order.number)}</span> · {order.customerName}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={order.status} overdue={order.overdue} />
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-graphite">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          التسليم {formatDateAr(order.deliveryDate)}
        </span>
        <span className="inline-flex h-7 items-center rounded-full border border-line bg-surface px-3 text-graphite">الاستلام {formatDateAr(order.receivedDate)}</span>
      </div>

      {canRecord && (
        <Link href={`${base}/orders/${order.id}/production`} className={buttonVariants({ size: "lg", className: "w-full" })}>
          <Factory className="size-5" aria-hidden="true" />
          تسجيل إنتاج / جاهز
        </Link>
      )}

      <FlowCard title={`بنود ${department.name}`} icon={Layers} aside={<span className="text-sm text-graphite">{formatNumber(view.items.length)} بند</span>}>
        <ul className="space-y-3">
          {view.items.map((item) => (
            <li key={item.id} className="rounded-2xl bg-well p-3.5" data-testid="department-item">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display font-semibold break-words">{item.label}</h3>
                  <p className="text-sm text-graphite">
                    <span className="tabular">{formatNumber(item.quantity)}</span> {u}
                    {item.material && <> · {item.material}</>}
                  </p>
                </div>
                <WorkStatusChip status={item.status} />
              </div>
              <ProductionTrack className="mt-3" size="sm" required={item.quantity} ready={item.ready} delivered={item.delivered} />
              <p className="mt-1.5 text-xs text-graphite">
                جاهز <b className="tabular">{formatNumber(item.ready)}</b> · اتسلم <b className="tabular">{formatNumber(item.delivered)}</b> من {formatNumber(item.quantity)}
              </p>

              {item.designs.length > 0 ? (
                <ul className="mt-2.5 space-y-1.5">
                  {item.designs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-semibold">{d.label}</span> — {OPERATION_LABELS[d.operation]}
                        {(d.placements.length > 0 || d.customPlacements.length > 0) && <span className="text-graphite"> · {placementsText(d.placements, d.customPlacements)}</span>}
                      </span>
                      <span className="tabular shrink-0 text-xs text-graphite">
                        {formatNumber(item.design[d.id] ?? 0)} / {formatNumber(d.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-graphite">{item.description}</p>
              )}

              {item.sizes.length > 0 && (
                <p className="mt-2 text-sm">
                  <span className="text-graphite">المقاسات: </span>
                  {item.sizes.map((s) => `${s.label} ${formatNumber(s.quantity)}`).join(" · ")}
                </p>
              )}
              {item.notes && <p className="mt-2 rounded-xl bg-surface p-2.5 text-sm">{item.notes}</p>}
              {item.value !== undefined && (
                <p className="mt-2 flex items-baseline justify-between text-sm">
                  <span className="text-graphite">
                    {item.split ? "نصيب القسم من البند (تقسيم من المدير)" : `قيمة البند ${item.unitPrice ? `(${formatNumber(item.quantity)} × ${formatMoneyString(item.unitPrice)})` : ""}`}
                  </span>
                  <span className="tabular font-semibold">{item.value === null ? "غير موزّع" : formatMoneyString(item.value)}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      </FlowCard>

      {view.money && (
        <FlowCard title="فلوس القسم في الأوردر ده" icon={Info}>
          {view.sharedWork && view.sharedWork.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-2xl bg-well p-3 text-sm">
              <li className="text-xs text-graphite">نصيب القسم من بنود أقسام تانية (تقسيم من المدير):</li>
              {view.sharedWork.map((w) => (
                <li key={w.label} className="flex items-baseline justify-between">
                  <span>{w.label}</span>
                  <span className="tabular font-semibold">{formatMoneyString(w.value)}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="divide-y divide-hairline rounded-2xl bg-well px-4 text-sm">
            <div className="flex items-baseline justify-between py-2.5">
              <dt className="font-semibold">قيمة شغل القسم</dt>
              <dd className="tabular font-display text-lg font-semibold">{formatMoneyString(view.money.value)}</dd>
            </div>
            {view.money.collected !== undefined && view.money.status && (
              <>
                <div className="flex items-baseline justify-between py-2.5">
                  <dt className="text-graphite">تحصيل موزّع على القسم</dt>
                  <dd className="tabular font-semibold text-success-ink">{formatMoneyString(view.money.collected)}</dd>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-graphite">المتبقي ({formatMoneyString(view.money.outstanding!)})</dt>
                  <dd>
                    <PayStatusChip status={view.money.status} />
                  </dd>
                </div>
              </>
            )}
          </dl>
          {view.money.allocations && view.money.allocations.length > 0 && (
            <ul className="mt-3 divide-y divide-hairline text-sm">
              {view.money.allocations.map((a, i) => (
                <li key={`${a.paidAt}-${i}`} className="flex items-baseline justify-between py-2">
                  <span className="text-graphite">
                    {formatDateAr(a.paidAt)}
                    {a.isAdvance && " · مقدم"}
                  </span>
                  <span className="tabular font-semibold">{formatMoneyString(a.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-graphite">
            دي قيمة شغل القسم بس — مش إجمالي الأوردر. التحصيل الموزّع نصيب حسابي من دفعات العميل (بالنسبة) ومش فلوس اتدفعت للشريك.
          </p>
        </FlowCard>
      )}
    </div>
  );
}
