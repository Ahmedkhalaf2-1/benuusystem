import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ChevronLeft, HardHat, Plus } from "lucide-react";
import { Flash } from "@/components/flash";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { AttendanceButton } from "@/components/workers/attendance-button";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { formatMoneyString, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { jobLabel } from "@/lib/workers/labels";
import { listWorkers } from "@/server/services/worker-service";

export const metadata: Metadata = { title: "العمال" };

export default async function WorkersPage(props: PageProps<"/workers">) {
  const user = await requirePermission("workers:view");
  const sp = await props.searchParams;
  const showInactive = sp.all === "1";
  const workers = await listWorkers(prisma, user, { includeInactive: showInactive });
  const canRecord = hasPermission(user, "work:record");
  const today = todayDateString();
  const present = workers.filter((w) => w.today?.worked).length;
  const active = workers.filter((w) => w.isActive).length;

  return (
    <div>
      <Flash message={sp.saved === "attendance" ? "تم تسجيل الحضور ✓" : undefined} />
      <PageHeader
        title="العمال"
        subtitle={active > 0 ? `حضر النهارده ${present} من ${active}` : undefined}
        action={
          hasPermission(user, "workers:manage") && (
            <Link href="/workers/new" className={buttonVariants({ className: "shrink-0" })}>
              <Plus className="size-5" aria-hidden="true" />
              عامل جديد
            </Link>
          )
        }
      />
      {hasPermission(user, "workers:view-pay") && (
        <Link href="/workers/summary" className="mb-4 flex h-14 items-center justify-between rounded-2xl border bg-card px-4 font-semibold hover:border-primary/40">
          <span className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" aria-hidden="true" />
            حساب العمال (الشهر)
          </span>
          <ChevronLeft className="size-5 text-muted-foreground" aria-hidden="true" />
        </Link>
      )}

      {workers.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed bg-card px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-primary">
            <HardHat className="size-7" aria-hidden="true" />
          </span>
          <p className="mt-4 font-bold">لسه مفيش عمال</p>
          <p className="mt-1 text-sm text-muted-foreground">ضيف العمال عشان تسجل يومياتهم وشغلهم.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {workers.map((w) => (
            <li key={w.id} className={cn("rounded-2xl border bg-card p-4", !w.isActive && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <Link href={`/workers/${w.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-lg font-bold">{w.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {jobLabel(w.job, w.jobTitle)}
                    {!w.isActive && " · موقوف"}
                  </p>
                </Link>
                {w.pay && (
                  <div className="shrink-0 text-end">
                    <p className="text-[0.7rem] text-muted-foreground">المتبقي له</p>
                    <p className="whitespace-nowrap font-bold text-primary">{formatMoneyString(w.pay.owed)}</p>
                    {toCents(w.pay.advanceOutstanding) > 0n && (
                      <p className="text-[0.7rem] text-amber-800">عليه سلفة {formatMoneyString(w.pay.advanceOutstanding)}</p>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {w.today ? (
                  <span className={cn("inline-flex h-11 items-center rounded-xl px-3 text-sm font-semibold", w.today.worked ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground")}>
                    {w.today.worked ? "✓ حضر النهارده" : "غاب النهارده"}
                  </span>
                ) : (
                  canRecord && w.isActive && <AttendanceButton workerId={w.id} today={today} />
                )}
                {canRecord && w.isActive && (
                  <Link href={`/workers/${w.id}/work`} className={buttonVariants({ variant: "outline", className: "h-11" })}>
                    تسجيل شغل
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link href={showInactive ? "/workers" : "/workers?all=1"} className="mt-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline">
        {showInactive ? "إخفاء العمال الموقوفين" : "عرض العمال الموقوفين كمان"}
      </Link>
    </div>
  );
}
