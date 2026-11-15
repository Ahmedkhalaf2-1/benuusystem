import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupplierForm } from "@/components/finance/supplier-form";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { getSupplierForEdit } from "@/server/services/supplier-service";

export const metadata: Metadata = { title: "تعديل المورد" };

export default async function EditSupplierPage(props: PageProps<"/suppliers/[id]/edit">) {
  const user = await requirePermission("suppliers:manage");
  const { id } = await props.params;
  const supplier = /^[0-9a-f-]{36}$/i.test(id) ? await getSupplierForEdit(prisma, user, id) : null;
  if (!supplier) notFound();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="تعديل بيانات المورد" backHref={`/suppliers/${supplier.id}`} backLabel={supplier.name} />
      <SupplierForm supplier={supplier} />
    </div>
  );
}
