import type { Metadata } from "next";
import { CustomerForm } from "@/components/customers/customer-form";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "عميل جديد" };

export default async function NewCustomerPage() {
  await requirePermission("customers:manage");
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="عميل جديد" backHref="/customers" backLabel="العملاء" />
      <CustomerForm />
    </div>
  );
}
