import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { payCostAction } from "@/app/(app)/finance/actions";
import { PayOutForm } from "@/components/finance/pay-out-form";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { COST_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatMoneyString, toCents } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/labels";
import { getCostForPayment } from "@/server/services/cost-service";

export const metadata: Metadata = { title: "دفع تكلفة" };

export default async function PayCostPage(props: PageProps<"/costs/[id]/pay">) {
  const user = await requirePermission("payables:pay");
  const { id } = await props.params;
  const { from } = await props.searchParams;
  const cost = /^[0-9a-f-]{36}$/i.test(id) ? await getCostForPayment(prisma, user, id) : null;
  if (!cost) notFound();

  const backHref = from === "supplier" && cost.supplier ? `/suppliers/${cost.supplier.id}` : `/orders/${cost.order.id}#costs`;
  if (cost.voided || toCents(cost.remaining) <= 0n) redirect(backHref);

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={cost.supplier ? `دفعة لـ ${cost.supplier.name}` : "دفع تكلفة"} backHref={backHref} backLabel="رجوع" />
      <div className="mb-5 rounded-2xl border bg-card p-4">
        <p className="font-bold">{cost.description ?? COST_CATEGORY_LABELS[cost.category]}</p>
        <p className="text-sm text-muted-foreground">
          <span dir="ltr">{formatOrderNumber(cost.order.number)}</span> · {cost.order.customer.name} — {cost.order.title}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">التكلفة</dt>
            <dd className="font-bold">{formatMoneyString(cost.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">اتدفع</dt>
            <dd className="font-bold text-emerald-700">{formatMoneyString(cost.paid)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">لسه</dt>
            <dd className="font-bold text-primary">{formatMoneyString(cost.remaining)}</dd>
          </div>
        </dl>
      </div>
      <PayOutForm action={payCostAction} targetId={cost.id} remaining={cost.remaining} today={todayDateString()} returnTo={backHref} />
    </div>
  );
}
