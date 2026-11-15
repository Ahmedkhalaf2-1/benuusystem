import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banknote } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { WorkerPayForm } from "@/components/workers/worker-pay-form";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { getWorkerDetails } from "@/server/services/labor-service";

export const metadata: Metadata = { title: "دفع فلوس" };

export default async function PayWorkerPage(props: PageProps<"/workers/[id]/pay">) {
  const user = await requirePermission("workers:pay");
  const { id } = await props.params;
  const { type } = await props.searchParams;
  const worker = /^[0-9a-f-]{36}$/i.test(id) ? await getWorkerDetails(prisma, user, id, { days: 1 }) : null;
  if (!worker?.pay) notFound();
  return (
    <div className="mx-auto max-w-lg">
      <FlowHeader icon={Banknote} hue="green" title={type === "ADVANCE" ? "تسجيل سلفة" : "دفع فلوس"} backHref={`/workers/${worker.id}`} backLabel={worker.name} context={worker.name} />
      <WorkerPayForm workerId={worker.id} owed={worker.pay.owed} today={todayDateString()} initialType={type === "ADVANCE" ? "ADVANCE" : "WAGE"} />
    </div>
  );
}
