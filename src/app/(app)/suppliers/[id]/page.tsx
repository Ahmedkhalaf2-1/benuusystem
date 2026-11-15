import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Phone } from "lucide-react";
import { voidOutgoingPaymentAction } from "@/app/(app)/finance/actions";
import { SettlementBadge } from "@/components/finance/settlement-badge";
import { VoidRecordForm } from "@/components/finance/void-record-form";
import { Flash } from "@/components/flash";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, formatDateTimeAr } from "@/lib/dates";
import { COST_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatMoneyString, toCents } from "@/lib/money";
import { formatOrderNumber, PAYMENT_METHOD_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { getSupplierDetails } from "@/server/services/supplier-service";

export const metadata: Metadata = { title: "المورد" };

const FLASH: Record<string, string> = {
  created: "تم حفظ المورد ✓",
  updated: "تم حفظ التعديلات ✓",
  "paid-out": "تم تسجيل الدفعة ✓",
  "payment-voided": "تم إلغاء الدفعة",
};

export default async function SupplierPage(props: PageProps<"/suppliers/[id]">) {
  const user = await requirePermission("suppliers:view-balances");
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  const supplier = /^[0-9a-f-]{36}$/i.test(id) ? await getSupplierDetails(prisma, user, id) : null;
  if (!supplier) notFound();

  const canPay = hasPermission(user, "payables:pay");
  const canVoid = hasPermission(user, "finance:void");
  const unpaid = supplier.purchases.filter((p) => !p.voided && toCents(p.remaining) > 0n);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <PageHeader
        title={supplier.name}
        backHref="/suppliers"
        backLabel="الموردين"
        subtitle={
          supplier.phone ? (
            <a href={`tel:${supplier.phone.replace(/[^\d+]/g, "")}`} dir="ltr" className="inline-flex items-center gap-1.5">
              <Phone className="size-4" aria-hidden="true" />
              {supplier.phone}
            </a>
          ) : undefined
        }
        action={
          hasPermission(user, "suppliers:manage") && (
            <Link href={`/suppliers/${supplier.id}/edit`} className={buttonVariants({ variant: "outline", className: "shrink-0" })}>
              <Pencil className="size-4" aria-hidden="true" />
              تعديل
            </Link>
          )
        }
      />

      <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-well p-3">
            <dt className="text-xs text-muted-foreground">اشترينا منه</dt>
            <dd className="mt-1 whitespace-nowrap text-sm font-bold sm:text-base">{formatMoneyString(supplier.totals.purchased)}</dd>
          </div>
          <div className="rounded-2xl bg-green-soft p-3">
            <dt className="text-xs text-green-ink">دفعناله</dt>
            <dd className="mt-1 whitespace-nowrap text-sm font-bold text-green-ink sm:text-base" data-testid="supplier-paid">
              {formatMoneyString(supplier.totals.paid)}
            </dd>
          </div>
          <div className="rounded-2xl bg-amber-soft p-3">
            <dt className="text-xs text-amber-ink">لسه ليه</dt>
            <dd className="mt-1 whitespace-nowrap text-sm font-bold text-amber-ink sm:text-base" data-testid="supplier-outstanding">
              {formatMoneyString(supplier.totals.outstanding)}
            </dd>
          </div>
        </dl>
      </section>

      {unpaid.length > 0 && canPay && (
        <section className="rounded-[1.4rem] bg-amber-soft/70 p-4">
          <h2 className="mb-1 font-display text-[1.05rem] font-semibold">تسجيل دفعة للمورد</h2>
          <p className="mb-3 text-sm text-muted-foreground">اختار الحاجة اللي بتدفع تمنها:</p>
          <ul className="space-y-2">
            {unpaid.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/costs/${p.id}/pay?from=supplier`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)] active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.description ?? COST_CATEGORY_LABELS[p.category]}</p>
                    <p className="text-xs text-muted-foreground">
                      <span dir="ltr">{formatOrderNumber(p.orderNumber)}</span> · {p.customerName} · {formatDateAr(p.costDate)}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-[0.7rem] text-muted-foreground">لسه</p>
                    <p className="whitespace-nowrap font-bold text-amber-ink">{formatMoneyString(p.remaining)}</p>
                  </div>
                  <span className={buttonVariants({ size: "sm", className: "h-9 shrink-0 px-3" })}>ادفع</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
        <h2 className="mb-2 font-display text-[1.05rem] font-semibold">المشتريات ({supplier.purchases.length})</h2>
        {supplier.purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground">لسه مفيش مشتريات من المورد ده. المشتريات بتتسجل من صفحة الأوردر («إضافة تكلفة»).</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {supplier.purchases.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cn("font-semibold", p.voided && "text-muted-foreground line-through")}>
                      {p.description ?? COST_CATEGORY_LABELS[p.category]}
                    </p>
                    <Link href={`/orders/${p.orderId}#costs`} className="text-sm text-primary hover:underline">
                      <span dir="ltr">{formatOrderNumber(p.orderNumber)}</span> · {p.customerName} — {p.orderTitle}
                    </Link>
                    <p className="text-xs text-muted-foreground">{formatDateAr(p.costDate)}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className={cn("whitespace-nowrap font-bold", p.voided && "text-muted-foreground line-through")}>{formatMoneyString(p.amount)}</p>
                    <SettlementBadge status={p.status} voided={p.voided} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
        <h2 className="mb-2 font-display text-[1.05rem] font-semibold">الدفعات ({supplier.payments.length})</h2>
        {supplier.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">لسه مفيش دفعات للمورد ده.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {supplier.payments.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">{p.costLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateAr(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method]} · دفعها {p.recordedByName}
                    </p>
                    {p.notes && <p className="text-xs">{p.notes}</p>}
                  </div>
                  <p className={cn("shrink-0 whitespace-nowrap font-bold", p.voided ? "text-muted-foreground line-through" : "text-green-ink")}>
                    {formatMoneyString(p.amount)}
                  </p>
                </div>
                {p.voided ? (
                  <p className="mt-1 text-xs text-destructive">
                    ملغية — {p.voided.byName}: {p.voided.reason}
                  </p>
                ) : (
                  canVoid && (
                    <VoidRecordForm
                      action={voidOutgoingPaymentAction}
                      id={p.id}
                      returnTo={`/suppliers/${supplier.id}`}
                      label="إلغاء الدفعة دي"
                      confirmLabel="تأكيد إلغاء الدفعة"
                      note="الدفعة هتفضل ظاهرة بس مش هتتحسب، والمبلغ هيرجع على المورد."
                    />
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {supplier.notes && (
        <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
          <h2 className="mb-1 text-sm text-muted-foreground">ملاحظات</h2>
          <p className="whitespace-pre-wrap">{supplier.notes}</p>
        </section>
      )}
      <p className="text-center text-xs text-muted-foreground">
        اتسجل بواسطة {supplier.createdByName} · {formatDateTimeAr(supplier.createdAt)}
      </p>
    </div>
  );
}
