import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote, CalendarClock, Factory, Pencil, Phone, ReceiptText, Truck, User } from "lucide-react";
import type { ReactNode } from "react";
import { SoonBadge } from "@/components/coming-soon";
import { OrderCostsSection } from "@/components/finance/order-costs-section";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/orders/status-badge";
import { VoidPaymentForm } from "@/components/orders/void-payment-form";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { daysUntil, formatDateAr, formatDateTimeAr } from "@/lib/dates";
import { formatMoneyString, toCents } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, PAYMENT_METHOD_LABELS, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { getOrderCosts } from "@/server/services/cost-service";
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
};

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-bold">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
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

  const outstanding = toCents(order.outstanding);
  const canPay =
    hasPermission(user, "payments:record") && outstanding > 0n && order.status !== "CANCELLED" && order.status !== "COMPLETED";
  const canEdit = hasPermission(user, "orders:edit") && order.status !== "COMPLETED";
  const canVoid = hasPermission(user, "payments:void");
  const days = daysUntil(order.deliveryDate);
  const open = order.status === "NEW" || order.status === "IN_PROGRESS";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <PageHeader
        title={order.title}
        backHref="/orders"
        backLabel="كل الأوردرات"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="font-semibold">
              {formatOrderNumber(order.number)}
            </span>
            <StatusBadge status={order.status} overdue={order.overdue} />
          </span>
        }
      />

      {/* Money */}
      <section className="rounded-2xl border bg-card p-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-muted/60 p-3">
            <dt className="text-xs text-muted-foreground">إجمالي الأوردر</dt>
            <dd className="mt-1 whitespace-nowrap text-base font-bold sm:text-lg">{formatMoneyString(order.totalPrice)}</dd>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <dt className="text-xs text-emerald-800">المدفوع</dt>
            <dd className="mt-1 whitespace-nowrap text-base font-bold sm:text-lg text-emerald-700" data-testid="paid">
              {formatMoneyString(order.paid)}
            </dd>
          </div>
          <div className="rounded-xl bg-brand-soft p-3">
            <dt className="text-xs text-primary">المتبقي</dt>
            <dd className="mt-1 whitespace-nowrap text-base font-bold sm:text-lg text-primary" data-testid="outstanding">
              {formatMoneyString(order.outstanding)}
            </dd>
          </div>
        </dl>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {canPay ? (
            <Link href={`/orders/${order.id}/payments/new`} className={buttonVariants({ size: "lg" })}>
              <Banknote className="size-5" aria-hidden="true" />
              استلام دفعة
            </Link>
          ) : (
            <span className="flex h-12 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
              {order.status === "CANCELLED" ? "الأوردر ملغي" : outstanding <= 0n ? "متدفع بالكامل ✓" : "—"}
            </span>
          )}
          {canEdit && (
            <Link href={`/orders/${order.id}/edit`} className={buttonVariants({ size: "lg", variant: "outline" })}>
              <Pencil className="size-5" aria-hidden="true" />
              تعديل الأوردر
            </Link>
          )}
        </div>
      </section>

      <Section title="العميل" icon={<User className="size-5" />}>
        <div className="flex items-center justify-between gap-3">
          <Link href={`/customers/${order.customerId}`} className="font-semibold text-primary hover:underline">
            {order.customerName}
          </Link>
          {order.customerPhone && (
            <a href={`tel:${order.customerPhone.replace(/[^\d+]/g, "")}`} dir="ltr" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Phone className="size-4" aria-hidden="true" />
              {order.customerPhone}
            </a>
          )}
        </div>
      </Section>

      <Section title="المنتج والشغل المطلوب" icon={<ReceiptText className="size-5" />}>
        <dl className="divide-y">
          <Row label="المنتج">{order.productType}</Row>
          <Row label="الخامة">{order.material}</Row>
          <Row label="الكمية">
            <span className="text-lg font-bold">
              {formatNumber(order.quantity)} {UNIT_LABELS[order.unit]}
            </span>
          </Row>
        </dl>
        <ul className="mt-3 space-y-2">
          {order.groups.map((g) => (
            <li key={g.position} className="rounded-xl border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{g.description}</span>
                <span className="shrink-0 font-bold">
                  {formatNumber(g.quantity)} {UNIT_LABELS[order.unit]}
                </span>
              </div>
              {(g.material !== order.material || g.notes) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {g.material !== order.material && <>الخامة: {g.material}</>}
                  {g.material !== order.material && g.notes && " · "}
                  {g.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="المواعيد" icon={<CalendarClock className="size-5" />}>
        <dl className="divide-y">
          <Row label="تاريخ الاستلام">{formatDateAr(order.receivedDate)}</Row>
          <Row label="موعد التسليم">
            <span className={cn(order.overdue && "text-destructive")}>{formatDateAr(order.deliveryDate)}</span>
            {open && (
              <span className={cn("block text-xs", order.overdue ? "text-destructive" : "text-muted-foreground")}>
                {days < 0 ? `متأخر ${formatNumber(-days)} يوم` : days === 0 ? "التسليم النهارده" : `فاضل ${formatNumber(days)} يوم`}
              </span>
            )}
          </Row>
        </dl>
        {order.notes && (
          <div className="mt-3 rounded-xl bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">ملاحظات</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{order.notes}</p>
          </div>
        )}
      </Section>

      <Section title="فلوس العميل (المدفوعات)" icon={<Banknote className="size-5" />}>
        {order.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">لسه مفيش مدفوعات على الأوردر ده.</p>
        ) : (
          <ul className="divide-y">
            {order.payments.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={cn("text-lg font-bold", p.voided && "text-muted-foreground line-through")}>
                      {formatMoneyString(p.amount)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDateAr(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method]}
                      {p.isAdvance && " · مقدم"}
                    </p>
                    <p className="text-xs text-muted-foreground">سجّلها: {p.recordedByName}</p>
                    {p.notes && <p className="mt-1 text-sm">{p.notes}</p>}
                  </div>
                  {p.voided && (
                    <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">ملغية</span>
                  )}
                </div>
                {p.voided ? (
                  <p className="mt-1 text-xs text-destructive">
                    ألغاها {p.voided.byName} — {p.voided.reason}
                  </p>
                ) : (
                  canVoid && <VoidPaymentForm paymentId={p.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {costs && (
        <OrderCostsSection
          orderId={order.id}
          summary={costs}
          canRecord={hasPermission(user, "costs:record")}
          canPay={hasPermission(user, "payables:pay")}
          canVoid={hasPermission(user, "finance:void")}
        />
      )}

      <section className="rounded-2xl border border-dashed bg-card/60 p-4">
        <h2 className="mb-3 font-bold">قريبًا</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            { label: "تسجيل إنتاج", icon: Factory },
            { label: "تسليم قطع", icon: Truck },
          ].map(({ label, icon: Icon }) => (
            <li key={label} className="flex h-12 items-center justify-between gap-2 rounded-xl bg-muted px-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </span>
              <SoonBadge />
            </li>
          ))}
        </ul>
      </section>

      <p className="pb-2 text-center text-xs text-muted-foreground">
        سجّله {order.createdByName} · {formatDateTimeAr(order.createdAt)}
      </p>
    </div>
  );
}
