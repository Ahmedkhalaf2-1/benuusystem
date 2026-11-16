import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { CreateStaffForm } from "@/components/users/account-forms";
import { UserAvatar } from "@/components/layout/user-avatar";
import { requirePermission } from "@/lib/auth/current-user";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatNumber } from "@/lib/numbers";
import { cn } from "@/lib/utils";
import { listAccounts } from "@/server/services/staff-access-service";

export const metadata: Metadata = { title: "إدارة المستخدمين والصلاحيات" };

export default async function UsersPage() {
  const user = await requirePermission("users:manage");
  const accounts = await listAccounts(prisma, user);
  const staff = accounts.filter((a) => a.role === "STAFF");
  const owners = accounts.filter((a) => a.role === "OWNER_ADMIN");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">إدارة المستخدمين والصلاحيات</h1>
        <p className="mt-1 text-sm text-graphite">حدّد كل موظف يشوف إيه ويعمل إيه. الحساب الجديد بيبدأ من غير أي صلاحيات.</p>
      </header>

      <CreateStaffForm />

      <section aria-labelledby="staff-heading">
        <h2 id="staff-heading" className="mb-2 font-display text-[1.1rem] font-semibold">
          حسابات الموظفين ({formatNumber(staff.length)})
        </h2>
        {staff.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-line-strong bg-surface p-5 text-center text-sm text-graphite">لسه مفيش حسابات موظفين.</p>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-line bg-surface">
            {staff.map((a) => (
              <li key={a.id}>
                <Link href={`/users/${a.id}`} className="flex min-h-18 items-center gap-3 px-4 py-3 transition-colors hover:bg-well" data-testid="staff-row">
                  <UserAvatar name={a.name} className={cn("size-11", !a.isActive && "opacity-50")} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-semibold">
                      {a.name}
                      {!a.isActive && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[0.68rem] font-semibold text-danger-ink">موقوف</span>}
                    </p>
                    <p dir="ltr" className="truncate text-end text-xs text-graphite">
                      {a.email}
                    </p>
                    <p className="mt-0.5 text-xs text-graphite">
                      {a.permissions.length === 0 ? "من غير صلاحيات" : `${formatNumber(a.permissions.length)} صلاحية`}
                      {" · "}
                      {formatNumber(a.assignedOrders)} أوردر متحدد له
                      {a.sessions > 0 && <> · داخل على {formatNumber(a.sessions)} جهاز</>}
                    </p>
                  </div>
                  <ChevronLeft className="size-5 shrink-0 text-graphite" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="owners-heading" className="rounded-2xl border border-line bg-surface p-4">
        <h2 id="owners-heading" className="flex items-center gap-2 font-display font-semibold">
          <ShieldCheck className="size-4 text-violet" aria-hidden="true" />
          {ROLE_LABELS.OWNER_ADMIN}
        </h2>
        <ul className="mt-2 space-y-1 text-sm">
          {owners.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {o.name}
                {o.id === user.id && <span className="text-graphite"> (إنت)</span>}
              </span>
              <span className="shrink-0 text-xs text-graphite">{o.isActive ? "كل الصلاحيات" : "موقوف"}</span>
            </li>
          ))}
        </ul>
      </section>

    </div>
  );
}
