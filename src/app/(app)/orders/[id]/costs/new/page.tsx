import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CostForm } from "@/components/finance/cost-form";
import { ReceiptText } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { formatOrderNumber } from "@/lib/orders/labels";

export const metadata: Metadata = { title: "إضافة تكلفة" };

export default async function NewOrderCostPage(props: PageProps<"/orders/[id]/costs/new">) {
  await requirePermission("costs:record");
  const { id } = await props.params;
  const order = /^[0-9a-f-]{36}$/i.test(id)
    ? await prisma.order.findUnique({ where: { id }, select: { id: true, number: true, title: true, customer: { select: { name: true } } } })
    : null;
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-lg">
      <FlowHeader icon={ReceiptText} hue="amber"
        title="إضافة تكلفة"
        backHref={`/orders/${order.id}`}
        backLabel="رجوع للأوردر"
        context={
          <>
            <span dir="ltr">{formatOrderNumber(order.number)}</span> · {order.customer.name} — {order.title}
          </>
        }
      />
      <CostForm orderId={order.id} today={todayDateString()} />
    </div>
  );
}
