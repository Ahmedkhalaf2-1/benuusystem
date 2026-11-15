import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
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
      <FlowHeader icon={Pencil} hue="rose" title={`تعديل: ${worker.name}`} backHref={`/workers/${worker.id}`} backLabel="رجوع" />
      <WorkerForm worker={worker} />
    </div>
  );
}
