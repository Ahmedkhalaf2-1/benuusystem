import type { Metadata } from "next";
import { CustomerForm } from "@/components/customers/customer-form";
import { UserPlus } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { requirePermission } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "عميل جديد" };

export default async function NewCustomerPage() {
  await requirePermission("customers:manage");
  return (
    <div className="mx-auto max-w-lg">
      <FlowHeader icon={UserPlus} hue="violet" title="عميل جديد" backHref="/customers" backLabel="العملاء" />
      <CustomerForm />
    </div>
  );
}
