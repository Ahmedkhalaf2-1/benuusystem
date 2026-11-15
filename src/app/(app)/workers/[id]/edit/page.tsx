import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { WorkerForm } from "@/components/workers/worker-form";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { getWorkerForEdit } from "@/server/services/worker-service";

export const metadata: Metadata = { title: "تعديل العامل" };

export default async function EditWorkerPage(props: PageProps<"/workers/[id]/edit">) {
  const user = await requirePermission("workers:manage");
  const { id } = await props.params;
  const worker = /^[0-9a-f-]{36}$/i.test(id) ? await getWorkerForEdit(prisma, user, id) : null;
  if (!worker) notFound();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={`تعديل: ${worker.name}`} backHref={`/workers/${worker.id}`} backLabel="رجوع" />
      <WorkerForm worker={worker} />
    </div>
  );
}
