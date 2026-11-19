import type { Metadata } from "next";
import { BackLink } from "@/components/page-header";
import { OrderForm } from "@/components/orders/order-form";
import { emptyOrderDraft } from "@/components/orders/order-draft";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { recentMaterials } from "@/server/services/order-service";
import { listAccountOptions, treasuryRequiresAccount } from "@/server/services/treasury-service";
import { listAssignableStaff } from "@/server/services/order-visibility-service";

export const metadata: Metadata = { title: "أوردر جديد" };

export default async function NewOrderPage(props: PageProps<"/orders/new">) {
  const user = await requirePermission("orders:create");
  const { customer: customerId } = await props.searchParams;

  // Coming from a customer's page: start with that customer selected.
  const preselected =
    typeof customerId === "string" && /^[0-9a-f-]{36}$/i.test(customerId)
      ? await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, phone: true } })
      : null;
  if (preselected && !hasPermission(user, "customers:view-contact")) preselected.phone = null;

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href="/orders" label="كل الأوردرات" />
      <OrderForm
        mode="create"
        initial={emptyOrderDraft(preselected ? { mode: "existing", ...preselected } : null)}
        materialSuggestions={await recentMaterials(prisma, user)}
        // Owner picks who sees the order; new orders start private. A staff
        // member's own order is shared with them only (set by the server).
        accounts={await listAccountOptions(prisma, user)}
        treasuryCutover={(await treasuryRequiresAccount(prisma)).cutover}
        access={hasPermission(user, "orders:manage-access") ? { staff: await listAssignableStaff(prisma, user), initial: { visibility: "PRIVATE", userIds: [] } } : undefined}
      />
    </div>
  );
}
