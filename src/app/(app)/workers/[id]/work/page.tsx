import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardPen } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { WorkLogForm } from "@/components/workers/work-log-form";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { JOB_DEFAULTS } from "@/lib/workers/labels";

export const metadata: Metadata = { title: "تسجيل شغل" };

export default async function WorkLogPage(props: PageProps<"/workers/[id]/work">) {
  await requirePermission("work:record");
  const { id } = await props.params;
  const worker = /^[0-9a-f-]{36}$/i.test(id)
    ? await prisma.worker.findUnique({ where: { id }, select: { id: true, name: true, job: true, targetUnit: true } })
    : null;
  if (!worker) notFound();
  const defaults = JOB_DEFAULTS[worker.job];
  return (
    <div className="mx-auto max-w-lg">
      <FlowHeader icon={ClipboardPen} hue="blue" title="تسجيل شغل" backHref={`/workers/${worker.id}`} backLabel={worker.name} context={worker.name} />
      <WorkLogForm workerId={worker.id} today={todayDateString()} defaultWorkType={defaults.workType} defaultUnit={worker.targetUnit ?? defaults.unit} />
    </div>
  );
}
