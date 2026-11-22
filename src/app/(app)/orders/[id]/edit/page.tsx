import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/page-header";
import { OrderForm } from "@/components/orders/order-form";
import { draftFromOrder } from "@/components/orders/order-draft";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatOrderNumber } from "@/lib/orders/labels";
import { getOrderForEdit, recentMaterials } from "@/server/services/order-service";
import { getOrderAccess, listAssignableStaff } from "@/server/services/order-visibility-service";
import { listDepartmentOptions } from "@/server/services/department-service";
import { listActivePresetNames } from "@/server/services/product-preset-service";

export const metadata: Metadata = { title: "تعديل الأوردر" };

export default async function EditOrderPage(props: PageProps<"/orders/[id]/edit">) {
  const user = await requirePermission("orders:edit");
  const { id } = await props.params;
  const order = /^[0-9a-f-]{36}$/i.test(id) ? await getOrderForEdit(prisma, user, id) : null;
  if (!order || !order.money) notFound();
  const access = hasPermission(user, "orders:manage-access") ? await getOrderAccess(prisma, user, order.id) : null;
  // Active departments, plus any (since deactivated) department an item still has.
  const active = await listDepartmentOptions(prisma, user);
  const departments = [
    ...active,
    ...order.groups
      .map((g) => g.department)
      .filter((d): d is NonNullable<typeof d> => d !== null && !active.some((a) => a.id === d.id))
      .filter((d, i, list) => list.findIndex((x) => x.id === d.id) === i)
      .map((d) => ({ id: d.id, key: null, name: `${d.name} (متوقف)` })),
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/orders/${order.id}`} label="رجوع للأوردر" />
      {order.status === "COMPLETED" ? (
        <p className="rounded-xl bg-muted p-4 text-sm">الأوردر ده مكتمل ومينفعش يتعدل.</p>
      ) : (
        <OrderForm
          mode="edit"
          orderId={order.id}
          orderLabel={`${formatOrderNumber(order.number)} · ${order.customerName} — ${order.title}`}
          version={order.updatedAt}
          initial={draftFromOrder(order)}
          paid={order.money.paid}
          originalTotal={order.money.totalPrice}
          canEditPrice={hasPermission(user, "orders:edit-price")}
          canCancel={hasPermission(user, "orders:cancel")}
          materialSuggestions={await recentMaterials(prisma, user)}
          departments={departments}
          presets={await listActivePresetNames(prisma, user)}
          access={access ? { staff: await listAssignableStaff(prisma, user), initial: { visibility: access.visibility, userIds: access.userIds }, version: access.version } : undefined}
        />
      )}
    </div>
  );
}
