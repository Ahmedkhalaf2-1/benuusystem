import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { WorkdayForm } from "@/components/workers/workday-form";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { formatAmount, toCents } from "@/lib/money";

export const metadata: Metadata = { title: "تسجيل يومية" };

export default async function WorkdayPage(props: PageProps<"/workers/[id]/workday">) {
  const user = await requirePermission("work:record");
  const { id } = await props.params;
  const worker = /^[0-9a-f-]{36}$/i.test(id) ? await prisma.worker.findUnique({ where: { id }, select: { id: true, name: true, dailyWage: true } }) : null;
  if (!worker) notFound();
  // Only the owner sees (and may change) the wage.
  const standardWage = hasPermission(user, "workers:manage") ? formatAmount(toCents(worker.dailyWage)) : null;
  return (
    <div className="mx-auto max-w-lg">
      <FlowHeader icon={CalendarCheck} hue="rose" title="تسجيل يومية" backHref={`/workers/${worker.id}`} backLabel={worker.name} context={worker.name} />
      <WorkdayForm workerId={worker.id} today={todayDateString()} standardWage={standardWage} />
    </div>
  );
}
