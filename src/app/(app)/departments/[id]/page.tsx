import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, ClipboardList, HandCoins, ListChecks, Scale, Wallet } from "lucide-react";
import { CollectionHistoryList, DepartmentActivityList, DepartmentMoneyPanel, DepartmentOrderCard, DepartmentStatsPanel, WorkStatusSummary } from "@/components/departments/department-ui";
import { EmptyState, FlowCard } from "@/components/ds/primitives";
import { requireUser } from "@/lib/auth/current-user";
import { isOwner } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { getDepartmentDashboard } from "@/server/services/department-service";
import { orNotFound } from "../load";

export const metadata: Metadata = { title: "شغل القسم" };

/** One department's dashboard — built only from that department's items. */
export default async function DepartmentDashboardPage(props: PageProps<"/departments/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const dash = await orNotFound(() => getDepartmentDashboard(prisma, user, id));
  const base = `/departments/${dash.department.id}`;
  const owner = isOwner(user);

  return (
    <div className="space-y-6">
      {owner && (
        <Link href="/departments" className="-ms-1 inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-graphite hover:bg-surface hover:text-ink">
          <ArrowRight className="size-4" aria-hidden="true" />
          كل الأقسام
        </Link>
      )}
      <DepartmentStatsPanel name={dash.department.name} stats={dash.stats} eyebrow={dash.department.isActive ? "شغل القسم" : "قسم متوقف"} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="min-w-0 space-y-6">
          <FlowCard
            title="آخر أوردرات القسم"
            icon={ClipboardList}
            aside={
              <Link href={`${base}/orders`} className="text-sm font-semibold text-violet hover:underline">
                كل الأوردرات
              </Link>
            }
          >
            {dash.recentOrders.length === 0 ? (
              <EmptyState icon={ClipboardList} title="لسه مفيش شغل للقسم">
                أول ما يتسجل أوردر فيه بند للقسم ده هيظهر هنا.
              </EmptyState>
            ) : (
              <ul className="grid gap-3 xl:grid-cols-2">
                {dash.recentOrders.map((row) => (
                  <li key={row.orderId}>
                    <DepartmentOrderCard row={row} href={`${base}/orders/${row.orderId}`} />
                  </li>
                ))}
              </ul>
            )}
          </FlowCard>

          <FlowCard title="حالة بنود القسم" icon={ListChecks}>
            <WorkStatusSummary stats={dash.stats} />
          </FlowCard>
        </div>

        <div className="mt-6 space-y-6 lg:mt-0">
          {dash.stats.money && (
            <FlowCard title={dash.stats.money.collections ? "قيمة الشغل والتحصيل" : "قيمة الشغل"} icon={Wallet}>
              <DepartmentMoneyPanel money={dash.stats.money} />
            </FlowCard>
          )}
          {dash.collectionHistory && (
            <FlowCard
              title="آخر تحصيل موزّع"
              icon={HandCoins}
              aside={
                <Link href={`${base}/collections`} className="text-sm font-semibold text-violet hover:underline">
                  السجل كله
                </Link>
              }
            >
              <CollectionHistoryList rows={dash.collectionHistory.slice(0, 6)} hrefFor={(orderId) => `${base}/orders/${orderId}`} />
            </FlowCard>
          )}
          {dash.access.canViewSettlements && (
            <Link href={`${base}/settlement`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface p-4 font-semibold hover:border-line-strong">
              <span className="flex size-9 items-center justify-center rounded-xl bg-violet-soft text-violet">
                <Scale className="size-[1.1rem]" aria-hidden="true" />
              </span>
              {owner ? "حسابات التسوية مع الشركاء في القسم" : "حساب التسوية بتاعي"}
            </Link>
          )}
          <FlowCard title="آخر حركة" icon={Activity}>
            <DepartmentActivityList items={dash.activity} hrefFor={(orderId) => `${base}/orders/${orderId}`} />
          </FlowCard>
        </div>
      </div>
    </div>
  );
}
