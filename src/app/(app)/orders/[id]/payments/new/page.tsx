import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PaymentForm } from "@/components/orders/payment-form";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { formatMoneyString, toCents } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/labels";
import { getOrderDetails } from "@/server/services/order-service";

export const metadata: Metadata = { title: "استلام دفعة" };

export default async function NewPaymentPage(props: PageProps<"/orders/[id]/payments/new">) {
  const user = await requirePermission("payments:record");
  const { id } = await props.params;
  const order = /^[0-9a-f-]{36}$/i.test(id) ? await getOrderDetails(prisma, user, id) : null;
  if (!order) notFound();
  if (toCents(order.outstanding) <= 0n || order.status === "CANCELLED") redirect(`/orders/${order.id}`);

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="استلام دفعة" backHref={`/orders/${order.id}`} backLabel="رجوع للأوردر" />
      <div className="mb-5 rounded-2xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          <span dir="ltr">{formatOrderNumber(order.number)}</span> · {order.customerName}
        </p>
        <p className="font-bold">{order.title}</p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">الإجمالي</dt>
            <dd className="font-bold">{formatMoneyString(order.totalPrice)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">المدفوع</dt>
            <dd className="font-bold text-emerald-700">{formatMoneyString(order.paid)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">المتبقي</dt>
            <dd className="font-bold text-primary">{formatMoneyString(order.outstanding)}</dd>
          </div>
        </dl>
      </div>
      <PaymentForm orderId={order.id} outstanding={order.outstanding} today={todayDateString()} />
    </div>
  );
}
