import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { OrderForm } from "@/components/orders/order-form";
import { emptyOrderDraft } from "@/components/orders/order-draft";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { recentMaterials } from "@/server/services/order-service";

export const metadata: Metadata = { title: "أوردر جديد" };

export default async function NewOrderPage(props: PageProps<"/orders/new">) {
  const user = await requirePermission("orders:create");
  const { customer: customerId } = await props.searchParams;

  // Coming from a customer's page: start with that customer selected.
  const preselected =
    typeof customerId === "string" && /^[0-9a-f-]{36}$/i.test(customerId)
      ? await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, phone: true } })
      : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="أوردر جديد" backHref="/orders" backLabel="كل الأوردرات" />
      <OrderForm
        mode="create"
        initial={emptyOrderDraft(preselected ? { mode: "existing", ...preselected } : null)}
        materialSuggestions={await recentMaterials(prisma, user)}
      />
    </div>
  );
}
