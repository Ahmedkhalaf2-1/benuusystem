import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote, CalendarCheck, ClipboardPen, HandCoins, Pencil, Phone } from "lucide-react";
import { voidOutgoingPaymentAction } from "@/app/(app)/finance/actions";
import { voidWorkdayAction, voidWorkLogAction } from "@/app/(app)/workers/actions";
import { VoidRecordForm } from "@/components/finance/void-record-form";
import { Flash } from "@/components/flash";
import { BackLink } from "@/components/page-header";
import { HueIcon, type Hue } from "@/components/ds/primitives";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { formatMoneyString, toCents } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { jobLabel, WORK_TYPE_LABELS, WORK_UNIT_LABELS, WORKER_PAYMENT_TYPE_LABELS } from "@/lib/workers/labels";
import { getWorkerDetails } from "@/server/services/labor-service";

export const metadata: Metadata = { title: "العامل" };

const FLASH: Record<string, string> = {
  created: "تم حفظ العامل ✓",
  updated: "تم حفظ التعديلات ✓",
  workday: "تم تسجيل اليومية ✓",
  work: "تم تسجيل الشغل ✓",
  "work-and-day": "تم تسجيل الشغل ✓ (واتسجل إنه حضر اليوم ده)",
  paid: "تم تسجيل الدفعة ✓",
  advance: "تم تسجيل السلفة ✓",
  "day-voided": "تم إلغاء اليومية",
  "log-voided": "تم إلغاء الشغل",
  "payment-voided": "تم إلغاء الدفعة",
};

const UNALLOCATED_REASON: Record<string, string> = {
  NO_WORK: "مفيش شغل متسجل اليوم ده — اليومية مش متوزعة على أوردرات.",
  MIXED_UNITS_NO_HOURS: "اشتغل بوحدات مختلفة من غير ساعات — اليومية مش متوزعة. المدير يقدر يلغي الشغل ويسجله بالساعات.",
};

export default async function WorkerPage(props: PageProps<"/workers/[id]">) {
  const user = await requirePermission("workers:view");
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  const w = /^[0-9a-f-]{36}$/i.test(id) ? await getWorkerDetails(prisma, user, id) : null;
  if (!w) notFound();

  const canRecord = hasPermission(user, "work:record") && w.isActive;
  const canPay = hasPermission(user, "workers:pay");
  const canCorrect = hasPermission(user, "workers:correct");
  const canVoidPayment = hasPermission(user, "finance:void");
  const targetText = w.dailyTarget && w.targetUnit ? `${formatNumber(w.dailyTarget)} ${WORK_UNIT_LABELS[w.targetUnit]}` : null;

  const actions = [
    canRecord && { href: `/workers/${w.id}/workday`, label: "تسجيل يومية", icon: CalendarCheck, hue: "rose" as Hue },
    canRecord && { href: `/workers/${w.id}/work`, label: "تسجيل شغل", icon: ClipboardPen, hue: "blue" as Hue },
    canPay && { href: `/workers/${w.id}/pay`, label: "دفع فلوس", icon: Banknote, hue: "green" as Hue },
    canPay && { href: `/workers/${w.id}/pay?type=ADVANCE`, label: "سلفة", icon: HandCoins, hue: "amber" as Hue },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Banknote; hue: Hue }[];

  const dayRow = (d: (typeof w.days)[number]) => (
              <li key={d.id} className={cn("py-3", d.voided && "opacity-60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={cn("font-semibold", d.voided && "line-through")}>{formatDateAr(d.date)}</p>
                    <p className="text-sm text-muted-foreground">
                      {d.voided ? `ملغية — ${d.voided.reason}` : d.worked ? "حضر" : "غاب"}
                      {d.worked && !d.voided && d.output.length > 0 && ` · ${d.output.map((o) => `${formatNumber(o.quantity)} ${WORK_UNIT_LABELS[o.unit]}`).join(" + ")}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    {d.achievement && !d.voided && (
                      <p className={cn("text-lg font-bold", Number(d.achievement) >= 100 ? "text-green-ink" : "text-amber-ink")} data-testid="day-achievement">
                        {d.achievement}%
                      </p>
                    )}
                    {d.pay && d.worked && !d.voided && (
                      <p className="text-xs text-muted-foreground">
                        يومية {formatMoneyString(d.pay.wage)}
                        {d.pay.costPerUnit && <span data-testid="day-cpu"> · الوحدة بـ {formatMoneyString(d.pay.costPerUnit)}</span>}
                      </p>
                    )}
                  </div>
                </div>
                {d.pay && !d.voided && d.pay.unallocatedReason && toCents(d.pay.unallocated) > 0n && (
                  <p className="mt-1 rounded-lg bg-amber-soft px-2 py-1 text-xs text-amber-ink">{UNALLOCATED_REASON[d.pay.unallocatedReason]}</p>
                )}
                {d.logs.length > 0 && !d.voided && (
                  <ul className="mt-2 space-y-1.5">
                    {d.logs.map((l) => (
                      <li key={l.id} className="rounded-xl bg-muted/50 px-3 py-2 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <span>
                            <b>
                              {formatNumber(l.quantity)} {WORK_UNIT_LABELS[l.unit]}
                            </b>{" "}
                            {WORK_TYPE_LABELS[l.workType]}
                            {l.hours && ` · ${l.hours} ساعة`}
                            {l.orderId ? (
                              <>
                                {" · "}
                                <Link href={`/orders/${l.orderId}`} className="text-primary hover:underline">
                                  {l.orderLabel}
                                </Link>
                                {l.groupPosition && ` (مجموعة ${l.groupPosition})`}
                              </>
                            ) : (
                              " · بدون أوردر"
                            )}
                          </span>
                          {l.share && <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{formatMoneyString(l.share)}</span>}
                        </div>
                        {canCorrect && (
                          <VoidRecordForm action={voidWorkLogAction} id={l.id} label="إلغاء الشغل ده" confirmLabel="تأكيد الإلغاء" note="الشغل هيفضل ظاهر في السجل، واليومية هتتقسم من جديد." />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canCorrect && !d.voided && (
                  <VoidRecordForm
                    action={voidWorkdayAction}
                    id={d.id}
                    label="إلغاء اليومية دي"
                    confirmLabel="تأكيد إلغاء اليومية"
                    note="اليومية وشغل اليوم ده هيتلغوا (ويفضلوا ظاهرين). تقدر تسجل اليوم من جديد بعدها."
                  />
                )}
              </li>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <BackLink href="/workers" label="العمال" />
      <section className="relative overflow-hidden rounded-[1.9rem] bg-gradient-to-br from-[#e8558a] to-rose-ink p-5 text-white shadow-[0_16px_34px_-16px_rgb(224_69_123/0.8)]">
        <div className="flex items-start gap-3.5">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/20 font-display text-xl font-semibold ring-2 ring-white/30">{w.name.trim().charAt(0)}</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[1.6rem] leading-tight font-semibold tracking-[-0.02em]">{w.name}</h1>
            <p className="mt-0.5 text-sm text-white/80">
              {jobLabel(w.job, w.jobTitle)}
              {!w.isActive && <span className="ms-2 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">موقوف</span>}
            </p>
            {w.phone && (
              <a
                href={`tel:${w.phone.replace(/[^\d+]/g, "")}`}
                dir="ltr"
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-semibold ring-1 ring-white/20 hover:bg-white/25"
              >
                <Phone className="size-3.5" aria-hidden="true" />
                {w.phone}
              </a>
            )}
          </div>
          {hasPermission(user, "workers:manage") && (
            <Link
              href={`/workers/${w.id}/edit`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-semibold ring-1 ring-white/20 hover:bg-white/25"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              تعديل
            </Link>
          )}
        </div>
      </section>

      {actions.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5">
          {actions.map(({ href, label, icon, hue }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex h-[5.25rem] items-center gap-3 rounded-[1.4rem] bg-surface px-3.5 shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-150 hover:shadow-[var(--shadow-lift)] active:scale-[0.97]"
              >
                <HueIcon icon={icon} hue={hue} />
                <span className="font-display font-semibold">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {w.pay && (
        <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl bg-violet-soft p-3">
              <p className="text-xs text-violet">المتبقي له</p>
              <p className="tabular mt-1 whitespace-nowrap font-display text-xl font-semibold text-violet" data-testid="worker-owed">
                {formatMoneyString(w.pay.owed)}
              </p>
            </div>
            <div className="rounded-2xl bg-amber-soft p-3">
              <p className="text-xs text-amber-ink">سلف لسه متخصمتش</p>
              <p className="tabular mt-1 whitespace-nowrap font-display text-xl font-semibold text-amber-ink" data-testid="worker-advance">
                {formatMoneyString(w.pay.advanceOutstanding)}
              </p>
            </div>
          </div>
          <dl className="mt-3 divide-y divide-hairline text-sm">
            <div className="flex justify-between py-2">
              <dt className="text-muted-foreground">اليومية</dt>
              <dd className="font-semibold">{formatMoneyString(w.pay.dailyWage)}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-muted-foreground">اتكسب الشهر ده</dt>
              <dd className="font-semibold">{formatMoneyString(w.pay.earnedThisMonth)}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-muted-foreground">إجمالي اللي اشتغله</dt>
              <dd className="font-semibold" data-testid="worker-earned">{formatMoneyString(w.pay.earnedTotal)}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-muted-foreground">اتدفع له يوميات</dt>
              <dd className="font-semibold text-green-ink">{formatMoneyString(w.pay.wagePaymentsTotal)}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-muted-foreground">أخد سلف</dt>
              <dd className="font-semibold text-amber-ink">{formatMoneyString(w.pay.advancesTotal)}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
        <h2 className="mb-2 font-display text-[1.05rem] font-semibold">الشهر ده</h2>
        <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
          <div className="rounded-2xl bg-well p-3">
            <dt className="text-xs text-muted-foreground">أيام الشغل</dt>
            <dd className="mt-1 text-xl font-bold">{formatNumber(w.month.daysWorked)}</dd>
          </div>
          <div className="rounded-2xl bg-well p-3">
            <dt className="text-xs text-muted-foreground">الإنتاج</dt>
            <dd className="mt-1 text-sm font-bold">
              {w.month.output.length === 0 ? "—" : w.month.output.map((o) => `${formatNumber(o.quantity)} ${WORK_UNIT_LABELS[o.unit]}`).join(" · ")}
            </dd>
          </div>
          {targetText && (
            <div className="col-span-2 rounded-2xl bg-well p-3 sm:col-span-1">
              <dt className="text-xs text-muted-foreground">من المستهدف ({targetText} في اليوم)</dt>
              <dd className="mt-1 text-xl font-bold">{w.month.achievement ? `${w.month.achievement}%` : "—"}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
        <h2 className="mb-2 font-display text-[1.05rem] font-semibold">الأيام</h2>
        {w.days.length === 0 ? (
          <p className="text-sm text-muted-foreground">لسه مفيش أيام متسجلة.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {w.days.slice(0, 7).map((d) => dayRow(d))}
          </ul>
        )}
        {w.days.length > 7 && (
          <details className="group/older mt-1">
            <summary className="flex h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-violet [&::-webkit-details-marker]:hidden">
              عرض الأيام الأقدم ({formatNumber(w.days.length - 7)})
            </summary>
            <ul className="divide-y divide-hairline">{w.days.slice(7).map((d) => dayRow(d))}</ul>
          </details>
        )}
      </section>

      {w.pay && (
        <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
          <h2 className="mb-2 font-display text-[1.05rem] font-semibold">الفلوس اللي اتدفعت له</h2>
          {w.pay.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">لسه مفيش دفعات.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {w.pay.payments.map((p) => (
                <li key={p.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{WORKER_PAYMENT_TYPE_LABELS[p.type]}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateAr(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method]} · سجّلها {p.recordedByName}
                      </p>
                      {p.notes && <p className="text-xs">{p.notes}</p>}
                    </div>
                    <p className={cn("shrink-0 whitespace-nowrap font-bold", p.voided ? "text-muted-foreground line-through" : p.type === "ADVANCE" ? "text-amber-ink" : "text-green-ink")}>
                      {formatMoneyString(p.amount)}
                    </p>
                  </div>
                  {p.voided ? (
                    <p className="mt-1 text-xs text-destructive">
                      ملغية — {p.voided.byName}: {p.voided.reason}
                    </p>
                  ) : (
                    canVoidPayment && (
                      <VoidRecordForm action={voidOutgoingPaymentAction} id={p.id} returnTo={`/workers/${w.id}`} label="إلغاء الدفعة دي" confirmLabel="تأكيد إلغاء الدفعة" note="الدفعة هتفضل ظاهرة بس مش هتتحسب." />
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {w.notes && <p className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4 text-sm">{w.notes}</p>}
    </div>
  );
}
