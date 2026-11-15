import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { WorkerForm } from "@/components/workers/worker-form";
import { requirePermission } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "عامل جديد" };

export default async function NewWorkerPage() {
  await requirePermission("workers:manage");
  return (
    <div className="mx-auto max-w-lg">
      <FlowHeader icon={UserPlus} hue="rose" title="عامل جديد" backHref="/workers" backLabel="العمال" context="العامل مش محتاج يوزر أو باسورد." />
      <WorkerForm />
    </div>
  );
}
