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
        action={
          hasPermission(user, "workers:manage") && (
            <Link href="/workers/new" className={buttonVariants({ className: "shrink-0" })}>
              <Plus className="size-5" aria-hidden="true" />
              عامل جديد
            </Link>
          )
        }
      />
      {active > 0 && (
        <section className="mb-4 rounded-[1.6rem] bg-gradient-to-br from-[#e8558a] to-rose-ink p-5 text-white shadow-[0_16px_34px_-16px_rgb(224_69_123/0.8)]">
          <p className="text-sm text-white/80">حضور النهارده</p>
          <p className="mt-0.5 font-display text-[2.1rem] leading-none font-semibold">
            <span className="tabular">{present}</span> <span className="text-lg font-medium text-white/80">من {active} عامل</span>
          </p>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/20" role="img" aria-label={`حضر ${present} من ${active}`}>
            <span className="block h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${(present / active) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-white/75">{present === active ? "كل العمال اتسجل حضورهم ✓" : "دوس «حضر النهارده» جنب كل عامل جه."}</p>
        </section>
      )}
      {hasPermission(user, "workers:view-pay") && (
        <Link href="/workers/summary" className="mb-4 flex h-14 items-center justify-between rounded-[1.4rem] bg-surface px-4 font-semibold shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)]">
          <span className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" aria-hidden="true" />
            حساب العمال (الشهر)
          </span>
          <ChevronLeft className="size-5 text-muted-foreground" aria-hidden="true" />
        </Link>
      )}

      {workers.length === 0 ? (
        <div className="flex flex-col items-center rounded-[1.6rem] border-2 border-dashed border-[#d9d2ea] bg-surface/60 px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-soft text-violet">
            <HardHat className="size-7" aria-hidden="true" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">لسه مفيش عمال</p>
          <p className="mt-1 text-sm text-muted-foreground">ضيف العمال عشان تسجل يومياتهم وشغلهم.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {workers.map((w) => (
            <li key={w.id} className={cn("rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4", !w.isActive && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <Link href={`/workers/${w.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-rose-soft font-display font-semibold text-rose-ink">{w.name.trim().charAt(0)}</span>
                  <span className="min-w-0">
                  <p className="truncate font-display text-[1.05rem] font-semibold">{w.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {jobLabel(w.job, w.jobTitle)}
                    {!w.isActive && " · موقوف"}
                  </p>
                  </span>
                </Link>
                {w.pay && (
                  <div className="shrink-0 text-end">
                    <p className="text-[0.7rem] text-muted-foreground">المتبقي له</p>
                    <p className="tabular whitespace-nowrap font-display font-semibold text-violet">{formatMoneyString(w.pay.owed)}</p>
                    {toCents(w.pay.advanceOutstanding) > 0n && (
                      <p className="text-[0.7rem] text-amber-ink">عليه سلفة {formatMoneyString(w.pay.advanceOutstanding)}</p>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {w.today ? (
                  <span className={cn("inline-flex h-11 items-center rounded-2xl px-3.5 text-sm font-semibold", w.today.worked ? "bg-green-soft text-green-ink" : "bg-muted text-graphite")}>
                    {w.today.worked ? "✓ حضر النهارده" : "غاب النهارده"}
                  </span>
                ) : (
                  canRecord && w.isActive && <AttendanceButton workerId={w.id} today={today} />
                )}
                {canRecord && w.isActive && (
                  <Link href={`/workers/${w.id}/work`} className={buttonVariants({ variant: "outline", className: "h-11 rounded-2xl" })}>
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
