import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { DeliveryForm } from "@/components/production/delivery-form";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { formatOrderNumber } from "@/lib/orders/labels";
import { getOrderProduction } from "@/server/services/production-service";

export const metadata: Metadata = { title: "تسليم قطع" };

export default async function NewDeliveryPage(props: PageProps<"/orders/[id]/deliveries/new">) {
  const user = await requirePermission("deliveries:record");
  const { id } = await props.params;
  const order = /^[0-9a-f-]{36}$/i.test(id)
    ? await prisma.order.findUnique({ where: { id }, select: { id: true, number: true, title: true, status: true, customer: { select: { name: true } } } })
    : null;
  if (!order) notFound();
  if (order.status === "CANCELLED") redirect(`/orders/${order.id}`);
  const production = (await getOrderProduction(prisma, user, order.id))!;
  return (
    <div className="mx-auto max-w-xl">
      <FlowHeader
        icon={Truck}
        hue="teal"
        title="تسليم قطع"
        backHref={`/orders/${order.id}#production`}
        backLabel="رجوع للأوردر"
        context={
          <>
            <span dir="ltr" className="tabular">{formatOrderNumber(order.number)}</span> · {order.customer.name} — {order.title}
          </>
        }
      />
      <DeliveryForm orderId={order.id} unit={production.unit} groups={production.groups} today={todayDateString()} />
    </div>
  );
}
