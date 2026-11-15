import type { Metadata } from "next";
import { SupplierForm } from "@/components/finance/supplier-form";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "مورد جديد" };

export default async function NewSupplierPage() {
  await requirePermission("suppliers:manage");
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="مورد جديد" backHref="/suppliers" backLabel="الموردين" />
      <SupplierForm />
    </div>
  );
}
