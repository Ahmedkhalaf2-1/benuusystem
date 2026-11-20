import type { Metadata } from "next";
import Link from "next/link";
import { Layers, Users } from "lucide-react";
import { CreateDepartmentForm, DepartmentSettingsForm } from "@/components/departments/department-admin-forms";
import { FlowCard } from "@/components/ds/primitives";
import { Flash } from "@/components/flash";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/current-user";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatNumber } from "@/lib/numbers";
import { listDepartmentsForAdmin } from "@/server/services/department-service";

export const metadata: Metadata = { title: "إدارة الأقسام" };

const FLASH: Record<string, string> = { created: "القسم اتضاف ✓", updated: "اتحفظ ✓" };

/** Owner: departments (add, rename, switch off) and who reaches each one. */
export default async function ManageDepartmentsPage(props: PageProps<"/departments/manage">) {
  const user = await requirePermission("users:manage");
  const { saved } = await props.searchParams;
  const departments = await listDepartmentsForAdmin(prisma, user);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <PageHeader title="إدارة الأقسام" subtitle="كل بند في أي أوردر بيتبع قسم واحد. الشركاء والموظفين بيشوفوا الأقسام اللي تديهم دخول عليها بس." backHref="/departments" backLabel="الأقسام" />
      <CreateDepartmentForm />
      {departments.map((d) => (
        <FlowCard key={d.id} title={d.name} icon={Layers} aside={<span className="text-sm text-graphite">{formatNumber(d._count.items)} بند</span>}>
          <DepartmentSettingsForm id={d.id} name={d.name} isActive={d.isActive} />
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-violet" aria-hidden="true" />
              مين ليه دخول
            </p>
            {d.members.length === 0 ? (
              <p className="rounded-xl bg-well p-3 text-sm text-graphite">المدير بس. إدي حد دخول من صفحة حسابه في «المستخدمين والصلاحيات».</p>
            ) : (
              <ul className="divide-y divide-hairline rounded-xl bg-well px-3">
                {d.members.map((m) => (
                  <li key={m.user.id}>
                    <Link href={`/users/${m.user.id}#departments`} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm hover:text-violet">
                      <span className="min-w-0 truncate">
                        {m.user.name} <span className="text-xs text-graphite">({ROLE_LABELS[m.user.role]}{m.user.isActive ? "" : " · موقوف"})</span>
                      </span>
                      <span className="shrink-0 text-xs text-graphite">
                        {[m.canViewWork ? "الشغل" : "مقفول", m.canRecordProduction && "تسجيل إنتاج", m.canViewMoney && "القيمة"].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FlowCard>
      ))}
    </div>
  );
}
