import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { WorkerForm } from "@/components/workers/worker-form";
import { requirePermission } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "عامل جديد" };

export default async function NewWorkerPage() {
  await requirePermission("workers:manage");
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="عامل جديد" backHref="/workers" backLabel="العمال" subtitle="العامل مش محتاج يوزر أو باسورد." />
      <WorkerForm />
    </div>
  );
}
