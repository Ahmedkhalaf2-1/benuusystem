import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/customers/customer-form";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { getCustomerForEdit } from "@/server/services/customer-service";

export const metadata: Metadata = { title: "تعديل العميل" };

export default async function EditCustomerPage(props: PageProps<"/customers/[id]/edit">) {
  const user = await requirePermission("customers:manage");
  const { id } = await props.params;
  const customer = /^[0-9a-f-]{36}$/i.test(id) ? await getCustomerForEdit(prisma, user, id) : null;
  if (!customer) notFound();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="تعديل بيانات العميل" backHref={`/customers/${customer.id}`} backLabel={customer.name} />
      <CustomerForm customer={customer} />
    </div>
  );
}
