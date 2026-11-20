import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CheckCircle2, Info } from "lucide-react";
import { EmptyState } from "@/components/ds/primitives";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber } from "@/lib/orders/labels";
import { listOverdueReceivables, OVERDUE_DAYS } from "@/server/services/receivables-alert-service";

export const metadata: Metadata = { title: "فلوس متأخرة بعد التسليم" };

/** Orders fully delivered ≥ 10 days ago with money still unpaid (internal alert — nothing is sent to customers). */
export default async function OverduePaymentsPage() {
  const user = await requirePermission("payments:view");
  const items = await listOverdueReceivables(prisma, user);
  const canPay = hasPermission(user, "payments:record");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="فلوس متأخرة بعد التسليم" subtitle={`${formatNumber(items.length)} أوردر اتسلم كله من ${formatNumber(OVERDUE_DAYS)} أيام أو أكتر ولسه عليه فلوس`} backHref="/orders" backLabel="الأوردرات" />
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="مفيش فلوس متأخرة">
          الأوردر بيظهر هنا لو اتسلم كله من {formatNumber(OVERDUE_DAYS)} أيام ولسه فاضل عليه فلوس.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((o) => (
            <li key={o.orderId} className="rounded-2xl border border-line bg-surface p-4 ring-1 ring-red/20" data-testid="overdue-payment">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/orders/${o.orderId}`} className="font-display text-lg font-semibold hover:text-violet">
                    {o.customerName}
                  </Link>
                  <p className="text-sm text-graphite">
                    {o.title} <span dir="ltr" className="tabular text-xs">{formatOrderNumber(o.number)}</span>
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger-ink">
                  <AlarmClock className="size-3.5" aria-hidden="true" />
                  {formatNumber(o.daysSinceDelivery)} يوم من التسليم
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-well py-2 text-center text-sm">
                <div>
                  <dt className="text-xs text-graphite">الإجمالي</dt>
                  <dd className="tabular font-semibold">{formatMoneyString(o.total)}</dd>
                </div>
                <div className="border-x border-hairline">
                  <dt className="text-xs text-graphite">اتحصّل</dt>
                  <dd className="tabular font-semibold text-success-ink">{formatMoneyString(o.collected)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-graphite">الباقي</dt>
                  <dd className="tabular font-semibold text-red">{formatMoneyString(o.remaining)}</dd>
                </div>
              </dl>
              <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-graphite">
                اتسلم كله {formatDateAr(o.fullDeliveryDate)}
                {canPay && (
                  <Link href={`/orders/${o.orderId}/payments/new`} className="font-semibold text-violet hover:underline">
                    تسجيل دفعة
                  </Link>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-start gap-2 text-xs text-graphite">
        <Info className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden="true" />
        تنبيه داخلي بس — مفيش رسايل بتتبعت للعميل. العدّ بيبدأ من يوم آخر تسليم كمّل الأوردر (مش يوم الاستلام ولا الموعد)، والتسليم الجزئي مش بيبدأ العدّ.
      </p>
    </div>
  );
}
