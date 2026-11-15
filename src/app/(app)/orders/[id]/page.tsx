import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote, CalendarDays, ClipboardList, Factory, HardHat, Pencil, Phone, ReceiptText, Truck, Wallet } from "lucide-react";
import { Fold, ProductionBreakdown, ProductionReadout, StagesCard } from "@/components/production/production-section";
import { OrderCostsSection } from "@/components/finance/order-costs-section";
import { OrderLaborSection } from "@/components/workers/order-labor-section";
import { Flash } from "@/components/flash";
import { dueText } from "@/components/ds/date-stamp";
import { ProductIcon } from "@/components/ds/order-cards";
import { StatusBadge } from "@/components/orders/status-badge";
import { VoidPaymentForm } from "@/components/orders/void-payment-form";
import { BackLink } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, formatDateTimeAr } from "@/lib/dates";
import { formatMoneyString, toCents } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, OPERATION_LABELS, PAYMENT_METHOD_LABELS, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { getOrderCosts } from "@/server/services/cost-service";
import { getOrderLabor } from "@/server/services/labor-service";
import { getOrderProduction } from "@/server/services/production-service";
import { getOrderDetails } from "@/server/services/order-service";

export const metadata: Metadata = { title: "تفاصيل الأوردر" };

const FLASH: Record<string, string> = {
  created: "تم حفظ الأوردر بنجاح ✓",
  updated: "تم حفظ التعديلات ✓",
  payment: "تم تسجيل الدفعة ✓",
  voided: "تم إلغاء الدفعة",
  cost: "تم حفظ التكلفة ✓",
  "cost-voided": "تم إلغاء التكلفة",
  "paid-out": "تم تسجيل الدفعة للمورد ✓",
  "payment-voided": "تم إلغاء الدفعة",
  stage: "تم تسجيل الإنتاج ✓",
  "stage-ready": "تم تسجيل الإنتاج والقطع بقت جاهزة للتسليم ✓",
  ready: "تم تسجيل القطع الجاهزة ✓",
  delivered: "تم تسجيل التسليم ✓",
  "production-voided": "تم إلغاء سجل الإنتاج",
  "delivery-voided": "تم إلغاء التسليم",
};

function Line({ label, children, strong, testId, tone }: { label: string; children: React.ReactNode; strong?: boolean; testId?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className={cn("text-sm", strong ? "font-semibold text-ink" : "text-graphite")}>{label}</dt>
      <dd data-testid={testId} className={cn("tabular font-display whitespace-nowrap", strong ? "text-xl font-semibold" : "font-medium", tone)}>
        {children}
      </dd>
    </div>
  );
}

export default async function OrderDetailsPage(props: PageProps<"/orders/[id]">) {
  const user = await requirePermission("orders:view");
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  const order = /^[0-9a-f-]{36}$/i.test(id) ? await getOrderDetails(prisma, user, id) : null;
  if (!order) notFound();
  const costs = hasPermission(user, "costs:view") ? await getOrderCosts(prisma, user, order.id) : null;
  const labor = hasPermission(user, "labor:view") ? await getOrderLabor(prisma, user, order.id) : null;
  const production = (await getOrderProduction(prisma, user, order.id))!;
  const partlyDelivered = production.totals.delivered > 0 && order.status !== "COMPLETED";

  const outstanding = toCents(order.outstanding);
  const canPay = hasPermission(user, "payments:record") && outstanding > 0n && order.status !== "CANCELLED" && order.status !== "COMPLETED";
  const canEdit = hasPermission(user, "orders:edit") && order.status !== "COMPLETED";
  const canVoid = hasPermission(user, "payments:void");
  const open = order.status === "NEW" || order.status === "IN_PROGRESS";
  const due = dueText(order.deliveryDate);
  const canRecordProd = hasPermission(user, "production:record") && order.status !== "CANCELLED";
  const canDeliver = hasPermission(user, "deliveries:record") && order.status !== "CANCELLED";
  const u = UNIT_LABELS[order.unit];
  const ops = [...new Set(order.groups.flatMap((g) => g.operations))];
  const hasReady = production.totals.readyNotDelivered > 0;

  const actions = (canRecordProd || canDeliver) && (
    <>
      {canRecordProd && (
        <Link
          href={`/orders/${order.id}/production/new`}
          className="flex h-13 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#6d47ea] to-violet-deep font-display font-semibold text-white shadow-[var(--shadow-violet)] transition-transform active:scale-[0.97]"
        >
          <Factory className="size-5" aria-hidden="true" />
          تسجيل إنتاج
        </Link>
      )}
      {canDeliver && (
        <Link
          href={`/orders/${order.id}/deliveries/new`}
          className={cn(
            "flex h-13 flex-1 items-center justify-center gap-2 rounded-2xl font-display font-semibold transition-transform active:scale-[0.97]",
            hasReady ? "bg-teal text-white shadow-[0_10px_24px_-12px_rgb(18_165_148/0.8)]" : "bg-surface text-ink shadow-[var(--shadow-soft)] ring-1 ring-hairline",
          )}
        >
          <Truck className="size-5" aria-hidden="true" />
          تسليم قطع
        </Link>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <BackLink href="/orders" label="كل الأوردرات" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="min-w-0 space-y-4">
          {/* Production control: the job on the brand stage */}
          <section className="stage animate-settle relative overflow-hidden rounded-[1.9rem] p-5 text-white shadow-[var(--shadow-violet)] sm:p-6">
            <span aria-hidden="true" className="pointer-events-none absolute -top-16 -end-10 size-48 rounded-full bg-[#ff7aa8]/20 blur-3xl" />
            <div className="relative">
              <div className="flex items-start gap-2">
                <span dir="ltr" className="tabular inline-flex h-7 items-center rounded-full bg-white/15 px-2.5 font-display text-xs font-semibold ring-1 ring-white/15">
                  {formatOrderNumber(order.number)}
                </span>
                <StatusBadge status={order.status} overdue={order.overdue} partlyDelivered={partlyDelivered} onDark />
                {canEdit && (
                  <Link
                    href={`/orders/${order.id}/edit`}
                    className="ms-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-semibold whitespace-nowrap ring-1 ring-white/15 hover:bg-white/25"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    تعديل الأوردر
                  </Link>
                )}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/15">
                  <ProductIcon productType={order.productType} className="size-6" />
                </span>
                <div className="min-w-0">
                  <h1 className="font-display text-[1.55rem] leading-tight font-semibold tracking-[-0.02em] text-balance">{order.title}</h1>
                  <p className="truncate text-sm text-white/75">
                    <Link href={`/customers/${order.customerId}`} className="font-semibold text-white underline decoration-white/30 underline-offset-4">
                      {order.customerName}
                    </Link>
                    {"، "}
                    {order.productType}
                    {order.material && <> من {order.material}</>}
                  </p>
                </div>
              </div>

              <p
                className={cn(
                  "mt-4 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
                  !open ? "bg-white/12 ring-1 ring-white/15" : due.tone === "late" ? "bg-red text-white" : due.tone === "today" || due.tone === "soon" ? "bg-amber text-white" : "bg-white/12 ring-1 ring-white/15",
                )}
              >
                <CalendarDays className="size-3.5" aria-hidden="true" />
                التسليم {formatDateAr(order.deliveryDate)}
                {open && <span className="font-normal opacity-90">— {due.text}</span>}
              </p>

              <div className="mt-5">
                <ProductionReadout production={production} />
              </div>
              {actions && <div className="mt-5 hidden gap-2.5 lg:flex">{actions}</div>}
            </div>
          </section>

          <StagesCard production={production} />
          <ProductionBreakdown production={production} canCorrect={hasPermission(user, "production:correct")} />
        </div>

        {/* Money and paperwork */}
        <div className="mt-4 space-y-4 lg:mt-0">
          <Fold
            title="الحساب"
            icon={Wallet}
            hue="bg-green-soft text-green-ink"
            meta={
              <>
                المتبقي <span className="tabular font-semibold text-ink">{formatMoneyString(order.outstanding)}</span>
              </>
            }
            open={canPay}
          >
            <div className="rounded-2xl bg-well px-3.5 py-1">
              <dl className="divide-y divide-hairline">
                <Line label="إجمالي الأوردر">{formatMoneyString(order.totalPrice)}</Line>
                <Line label="المدفوع" testId="paid" tone="text-green-ink">
                  {formatMoneyString(order.paid)}
                </Line>
                <Line label="المتبقي" testId="outstanding" strong>
                  {formatMoneyString(order.outstanding)}
                </Line>
              </dl>
            </div>
            {canPay ? (
              <Link
                href={`/orders/${order.id}/payments/new`}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green font-semibold text-white shadow-[0_10px_24px_-12px_rgb(34_160_90/0.8)] transition-[background-color,transform] hover:bg-green-ink active:scale-[0.98]"
              >
                <Banknote className="size-5" aria-hidden="true" />
                استلام دفعة
              </Link>
            ) : (
              <p className="mt-3 text-sm font-medium text-green-ink">{order.status === "CANCELLED" ? "الأوردر ملغي." : outstanding <= 0n ? "متدفع بالكامل ✓" : ""}</p>
            )}

            <h3 className="mt-5 text-sm font-semibold">المدفوعات</h3>
            {order.payments.length === 0 ? (
              <p className="mt-1 text-sm text-graphite">لسه مفيش مدفوعات على الأوردر ده.</p>
            ) : (
              <ul className="mt-1 divide-y divide-hairline">
                {order.payments.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={cn("tabular font-display text-lg font-semibold", p.voided && "text-graphite line-through")}>{formatMoneyString(p.amount)}</p>
                        <p className="text-sm text-graphite">
                          {formatDateAr(p.paidAt)}، {PAYMENT_METHOD_LABELS[p.method]}
                          {p.isAdvance && "، مقدم"}
                        </p>
                        <p className="text-xs text-graphite">سجّلها {p.recordedByName}</p>
                        {p.notes && <p className="mt-1 text-sm">{p.notes}</p>}
                      </div>
                      {p.voided && <span className="shrink-0 rounded-full bg-red-soft px-2.5 py-1 text-xs font-semibold text-red">ملغية</span>}
                    </div>
                    {p.voided ? (
                      <p className="mt-1 text-xs text-red">
                        ألغاها {p.voided.byName} — {p.voided.reason}
                      </p>
                    ) : (
                      canVoid && <VoidPaymentForm paymentId={p.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Fold>

          {costs ? (
            <Fold title="تكاليف الأوردر" icon={ReceiptText} hue="bg-amber-soft text-amber-ink" meta={formatMoneyString(costs.totals.costs)} open>
              <OrderCostsSection
                orderId={order.id}
                summary={costs}
                canRecord={hasPermission(user, "costs:record")}
                canPay={hasPermission(user, "payables:pay")}
                canVoid={hasPermission(user, "finance:void")}
              />
            </Fold>
          ) : (
            hasPermission(user, "costs:record") && (
              // Staff may record costs without seeing the order's cost totals.
              <section id="costs" className="flex items-center gap-3 rounded-[1.5rem] bg-surface p-4 shadow-[var(--shadow-card)]">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-soft text-amber-ink">
                  <ReceiptText className="size-[1.1rem]" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display font-semibold">تكاليف الأوردر</h2>
                  <p className="text-xs text-graphite">قماش، طباعة برّه، أي حاجة اتصرفت عليه.</p>
                </div>
                <Link href={`/orders/${order.id}/costs/new`} className={buttonVariants({ variant: "outline", className: "shrink-0" })}>
                  إضافة تكلفة
                </Link>
              </section>
            )
          )}
          {labor && (
            <Fold
              title="شغل العمال على الأوردر"
              icon={HardHat}
              hue="bg-rose-soft text-rose-ink"
              meta={<span className="tabular font-semibold text-ink">{formatMoneyString(labor.total)}</span>}
            >
              <OrderLaborSection labor={labor} />
            </Fold>
          )}

          <Fold title="تفاصيل الأوردر" icon={ClipboardList} meta={order.customerName}>
            <div className="rounded-2xl bg-well px-3.5 py-1">
              <dl className="divide-y divide-hairline">
                <Line label="العميل">{order.customerName}</Line>
                {order.customerPhone && (
                  <Line label="التليفون">
                    <a href={`tel:${order.customerPhone}`} dir="ltr" className="inline-flex items-center gap-1.5 text-violet">
                      <Phone className="size-4" aria-hidden="true" />
                      {order.customerPhone}
                    </a>
                  </Line>
                )}
                <Line label="المنتج">{order.productType}</Line>
                <Line label="الخامة">{order.material}</Line>
                <Line label="الكمية">{`${formatNumber(order.quantity)} ${u}`}</Line>
                {ops.length > 0 && <Line label="الشغل">{ops.map((op) => OPERATION_LABELS[op]).join(" + ")}</Line>}
                <Line label="تاريخ الاستلام">{formatDateAr(order.receivedDate)}</Line>
                <Line label="موعد التسليم">{formatDateAr(order.deliveryDate)}</Line>
              </dl>
            </div>
            {order.groups.some((g) => g.material !== order.material || g.notes) && (
              <ul className="mt-3 space-y-1 text-sm">
                {order.groups.map((g) =>
                  g.material !== order.material || g.notes ? (
                    <li key={g.position}>
                      <span className="font-semibold">مجموعة {formatNumber(g.position)}: </span>
                      {g.material !== order.material && <>الخامة {g.material}. </>}
                      {g.notes}
                    </li>
                  ) : null,
                )}
              </ul>
            )}
            {order.notes && (
              <div className="mt-3 rounded-2xl bg-amber-soft/60 p-3">
                <p className="text-xs font-semibold text-amber-ink">ملاحظات</p>
                <p className="mt-1 whitespace-pre-wrap text-[0.95rem] leading-relaxed">{order.notes}</p>
              </div>
            )}
            <p className="mt-3 text-xs text-graphite">
              سجّله {order.createdByName}، {formatDateTimeAr(order.createdAt)}
            </p>
          </Fold>
        </div>
      </div>

      {/* Phones: the two daily actions float above the tab bar. */}
      {actions && (
        <div className="sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 mt-5 lg:hidden">
          <div className="flex gap-2.5 rounded-[1.4rem] bg-canvas/80 p-1.5 backdrop-blur-xl">{actions}</div>
        </div>
      )}
    </div>
  );
}
