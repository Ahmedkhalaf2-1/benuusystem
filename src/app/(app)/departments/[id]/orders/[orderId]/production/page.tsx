import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Factory } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { ProductionForm } from "@/components/production/production-form";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { formatOrderNumber } from "@/lib/orders/labels";
import { getDepartmentOrder, productionGroups } from "@/server/services/department-service";
import { orNotFound } from "../../../../load";

export const metadata: Metadata = { title: "تسجيل إنتاج القسم" };

/** «تسجيل إنتاج» from a department: the department's items only; the server re-checks everything. */
export default async function DepartmentProductionPage(props: PageProps<"/departments/[id]/orders/[orderId]/production">) {
  const user = await requireUser();
  const { id, orderId } = await props.params;
  const view = await orNotFound(() => getDepartmentOrder(prisma, user, id, orderId));
  if (!view.department.canRecordProduction) notFound();
  const back = `/departments/${view.department.departmentId}/orders/${view.order.id}`;
  if (view.order.status !== "NEW" && view.order.status !== "IN_PROGRESS") redirect(back);

  return (
    <div className="mx-auto max-w-xl">
      <FlowHeader
        icon={Factory}
        hue="blue"
        title="تسجيل إنتاج"
        backHref={back}
        backLabel="رجوع للأوردر"
        context={
          <>
            <span dir="ltr" className="tabular">{formatOrderNumber(view.order.number)}</span> · {view.department.name} — {view.order.title}
          </>
        }
      />
      <ProductionForm orderId={view.order.id} unit={view.order.unit} groups={productionGroups(view.items)} today={todayDateString()} departmentId={view.department.departmentId} />
    </div>
  );
}
