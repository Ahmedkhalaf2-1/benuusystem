import type { Metadata } from "next";
import { HandCoins, Wallet } from "lucide-react";
import { CollectionHistoryList, DepartmentMoneyPanel } from "@/components/departments/department-ui";
import { FlowCard } from "@/components/ds/primitives";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { getDepartmentCollections } from "@/server/services/department-service";
import { orNotFound } from "../../load";

export const metadata: Metadata = { title: "تحصيل القسم" };

/** The department's allocated collections history (collections switch only). */
export default async function DepartmentCollectionsPage(props: PageProps<"/departments/[id]/collections">) {
  const user = await requireUser();
  const { id } = await props.params;
  const data = await orNotFound(() => getDepartmentCollections(prisma, user, id));
  const base = `/departments/${data.department.departmentId}`;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={`تحصيل ${data.department.name}`} subtitle="نصيب القسم المحسوب بالنسبة من كل دفعة عميل" backHref={base} backLabel={data.department.name} />
      <FlowCard title="الملخص" icon={Wallet}>
        <DepartmentMoneyPanel money={data.money} />
      </FlowCard>
      <FlowCard title="السجل" icon={HandCoins}>
        <CollectionHistoryList rows={data.history} hrefFor={(orderId) => `${base}/orders/${orderId}`} />
      </FlowCard>
    </div>
  );
}
