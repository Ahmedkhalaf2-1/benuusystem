import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, CheckCircle2, ChevronDown, ChevronLeft, Landmark, ListOrdered, PlusCircle, Scale, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import { Flash } from "@/components/flash";
import { Caveat, egp, PeriodPicker } from "@/components/reports/report-ui";
import { AccountActiveForm, AccountSetupForm, AttributeForm, MovementForm, ReconcileForm } from "@/components/treasury/treasury-forms";
import type { FinancialAccountType } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateAr, todayDateString } from "@/lib/dates";
import { prisma } from "@/lib/db/prisma";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders/labels";
import { parsePeriod, periodParams } from "@/lib/reports/period";
import { ACCOUNT_TYPE_LABELS } from "@/lib/treasury/labels";
import { cn } from "@/lib/utils";
import { getTreasuryOverview, listReconciliations } from "@/server/services/treasury-service";

export const metadata: Metadata = { title: "الخزنة والحسابات" };

const ICONS: Record<FinancialAccountType, LucideIcon> = { CASH: Banknote, BANK: Landmark, WALLET: Smartphone };
const INCOMPLETE = "الرصيد غير مكتمل — محتاج رصيد افتتاحي ومراجعة الحركات";

const FLASH: Record<string, string> = {
  account: "تم حفظ الحساب والرصيد الافتتاحي ✓",
  "account-status": "تم تحديث حالة الحساب ✓",
  movement: "تم تسجيل الحركة ✓",
  attributed: "اتسجلت الدفعة على الحساب ✓",
  reconciled: "تم تسجيل الجرد ✓",
};

function Section({ id, title, children, aside }: { id?: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={id ? `${id}-h` : undefined} className="font-display text-[1.1rem] font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * A closed tool panel: the numbers stay on top, each tool opens on demand.
 * Native <details>, so it works without JavaScript and keeps keyboard focus.
 */
function ToolPanel({ id, icon: Icon, title, hint, open, children }: { id?: string; icon: LucideIcon; title: string; hint: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details id={id} open={open} className="group/tool rounded-2xl border border-line bg-surface open:pb-4 sm:open:pb-5">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 hover:bg-well sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display font-semibold">{title}</span>
          <span className="block text-xs leading-snug text-graphite">{hint}</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-graphite transition-transform duration-200 group-open/tool:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="px-4 pt-1 sm:px-5">{children}</div>
    </details>
  );
}

/** Owner-only. Balances are computed from recorded money that actually moved; nothing here is stored or guessed. */
export default async function TreasuryPage(props: PageProps<"/treasury">) {
  const user = await requirePermission("treasury:manage");
  const sp = await props.searchParams;
  const period = parsePeriod(sp);
  const today = todayDateString();
  const [o, recs] = await Promise.all([getTreasuryOverview(prisma, user, { from: period.from, to: period.to }), listReconciliations(prisma, user, 10)]);
  const active = o.accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name, type: a.type }));
  const saved = typeof sp.saved === "string" ? sp.saved : undefined;
  const diff = typeof sp.diff === "string" ? sp.diff : null;
  const flash = saved === "reconciled" && diff ? (diff === "0.00" ? "الجرد مطابق للرصيد المسجل ✓" : `اتسجل الجرد — الفرق ${egp(diff)}`) : saved ? FLASH[saved] : undefined;
  const lastCount = new Map<string, (typeof recs)[number]>();
  for (const r of recs) if (!lastCount.has(r.accountName)) lastCount.set(r.accountName, r);
  const negative = new Set(o.issues.flatMap((i) => (i.kind === "NEGATIVE" ? [i.accountName] : [])));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Flash message={flash} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">الخزنة والحسابات</h1>
          <p className="mt-1 text-sm text-graphite">الفلوس اللي معانا فعلًا في كل حساب — مش قيمة الأوردرات ولا اللي عند العملاء.</p>
        </div>
        {o.accounts.length > 0 && (
          <Link href="/treasury/ledger" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-soft px-4 text-sm font-semibold text-brand-ink">
            <ListOrdered className="size-4" aria-hidden="true" />
            سجل الحركات
          </Link>
        )}
      </header>

      {!o.complete && (
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-warning-soft p-4 text-warning-ink" data-testid="treasury-incomplete">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold">{INCOMPLETE}</p>
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              {o.issues.map((i, n) =>
                i.kind === "NO_ACCOUNTS" ? (
                  <li key={n}>لسه مفيش حسابات. ابدأ بالخطوات تحت.</li>
                ) : i.kind === "UNATTRIBUTED" ? (
                  <li key={n}>
                    <a href="#unattributed" className="underline">
                      {i.count} دفعة من {formatDateAr(i.since)} لسه مش متحدد دخلت/خرجت من أنهي حساب
                    </a>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        </div>
      )}

      {/* The balance stage: only shown as a number when complete — never a fabricated zero. */}
      {o.accounts.length > 0 && (
        <section aria-label="الأرصدة" className="stage relative overflow-hidden rounded-2xl p-5 text-on-panel sm:p-6">
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-on-panel-muted">إجمالي الرصيد المسجل في كل الحسابات</p>
              {o.complete ? (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-panel-2 px-2.5 text-xs font-semibold text-panel-success ring-1 ring-panel-line">
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  كل الحركات متحددة
                </span>
              ) : (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-panel-2 px-2.5 text-xs font-semibold text-panel-warning ring-1 ring-panel-line">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  غير مكتمل — مش رصيد نهائي
                </span>
              )}
            </div>
            <p className="tabular mt-1 font-display text-[2.1rem] leading-tight font-semibold" data-testid="treasury-total">
              {o.total !== null ? egp(o.total) : "غير مكتمل"}
            </p>
            <p className="mt-1 text-xs text-on-panel-muted">رصيد افتتاحي متعدّ + الفلوس اللي دخلت − اللي خرجت. الجرد الفعلي بيتسجل لوحده تحت.</p>
            <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(["CASH", "BANK", "WALLET"] as const)
                .filter((t) => o.accounts.some((a) => a.type === t))
                .map((t) => (
                  <div key={t} className="rounded-2xl bg-panel-2 px-3.5 py-3 ring-1 ring-panel-line">
                    <dt className="text-xs text-on-panel-muted">{t === "CASH" ? "رصيد خزنة الكاش" : t === "BANK" ? "رصيد البنك" : "رصيد المحافظ"}</dt>
                    <dd className="tabular mt-0.5 font-display text-lg font-semibold">{o.byType[t] ? egp(o.byType[t]!) : "غير مكتمل"}</dd>
                  </div>
                ))}
            </dl>
          </div>
        </section>
      )}

      {o.accounts.length > 0 && (
        <Section title="الحسابات">
          <ul className="divide-y divide-hairline">
            {o.accounts.map((a) => {
              const Icon = ICONS[a.type];
              const count = lastCount.get(a.name);
              return (
                <li key={a.id} className={cn("py-3.5", !a.isActive && "opacity-60")} data-testid="treasury-account">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.name}</p>
                      <p className="text-xs text-graphite">
                        {ACCOUNT_TYPE_LABELS[a.type]}
                        {!a.isActive && " · متوقف"}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-[0.7rem] text-graphite">الرصيد المسجل</p>
                      <p className={cn("tabular font-display text-lg leading-tight font-semibold", negative.has(a.name) && "text-red")}>{egp(a.balance)}</p>
                    </div>
                  </div>
                  {negative.has(a.name) && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-ink">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                      رصيد سالب — راجع: سحب على المكشوف أو حركة ناقصة
                    </p>
                  )}
                  <dl className="mt-2.5 grid gap-1 rounded-xl bg-well px-3 py-2.5 text-xs sm:grid-cols-2">
                    <div className="flex flex-wrap gap-x-1.5">
                      <dt className="text-graphite">الرصيد الافتتاحي:</dt>
                      <dd>
                        <b className="tabular font-semibold text-ink">{egp(a.openingBalance)}</b> — جرد {a.basis === "START_OF_DAY" ? "بداية" : "آخر"} يوم {formatDateAr(a.countDate)}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-1.5">
                      <dt className="text-graphite">آخر جرد فعلي:</dt>
                      <dd>
                        {count ? (
                          <>
                            <b className="tabular font-semibold text-ink">{egp(count.counted)}</b> يوم {formatDateAr(count.date)}{" "}
                            {count.difference === "0.00" ? <span className="font-semibold text-success-ink">مطابق</span> : <span className="font-semibold text-danger-ink">فرق {egp(count.difference)}</span>}
                          </>
                        ) : (
                          <span className="text-graphite">لسه متعملش جرد</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-1 flex justify-end">
                    <AccountActiveForm accountId={a.id} active={a.isActive} />
                  </div>
                </li>
              );
            })}
          </ul>
          {!o.complete && <p className="mt-2 text-xs text-warning-ink">الأرصدة دي بالحركات المتحددة بس — مش نهائية لحد ما تحدد الدفعات اللي تحت.</p>}
        </Section>
      )}

      {/* Cash movement — explicitly NOT a balance. */}
      <Section title="حركة الفلوس في الفترة" aside={<PeriodPicker period={period} basePath="/treasury" />}>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-2xl bg-well p-3">
            <dt className="flex items-center gap-1.5 text-xs text-graphite">
              <ArrowDownLeft className="size-3.5 text-green-ink" aria-hidden="true" />
              إجمالي المقبوضات الفعلية
            </dt>
            <dd className="tabular mt-1 font-display text-lg font-semibold text-green-ink">{egp(o.period.receipts)}</dd>
          </div>
          <div className="rounded-2xl bg-well p-3">
            <dt className="flex items-center gap-1.5 text-xs text-graphite">
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
              إجمالي المدفوعات الفعلية
            </dt>
            <dd className="tabular mt-1 font-display text-lg font-semibold">{egp(o.period.payments)}</dd>
          </div>
          <div className="rounded-2xl bg-well p-3">
            <dt className="text-xs text-graphite">صافي الحركة النقدية</dt>
            <dd className="tabular mt-1 font-display text-lg font-semibold">{egp(o.period.net)}</dd>
          </div>
          <div className="rounded-2xl bg-well p-3">
            <dt className="text-xs text-graphite">إيداعات صاحب الشغل</dt>
            <dd className="tabular mt-1 font-display font-semibold">{egp(o.period.capitalIn)}</dd>
          </div>
          <div className="rounded-2xl bg-well p-3">
            <dt className="text-xs text-graphite">مسحوبات صاحب الشغل</dt>
            <dd className="tabular mt-1 font-display font-semibold">{egp(o.period.drawings)}</dd>
          </div>
        </dl>
        <div className="mt-3 space-y-2">
          <Caveat>صافي الحركة = اللي اتقبض − اللي اتدفع في الفترة، من كل الدفعات المسجلة. ده مش رصيد الخزنة ومش ربح. الإيداعات والمسحوبات والتحويلات مش داخلة فيه.</Caveat>
        </div>
      </Section>

      <Section title="المستحق عند العملاء">
        <p className="tabular font-display text-xl font-semibold" data-testid="treasury-receivables">
          {egp(o.receivables)}
        </p>
        <p className="mt-1 text-xs text-graphite">فلوس لسه ليك عند العملاء على أوردرات شغالة — مش موجودة في أي خزنة أو حساب لحد ما تتدفع.</p>
      </Section>

      {o.unattributed.length > 0 && (
        <Section id="unattributed" title={`دفعات لسه مش متحدد حسابها (${o.unattributed.length})`}>
          <p className="mb-2 text-xs text-graphite">
            دفعات من {formatDateAr(o.cutover!)} (بداية الخزنة) أو بعدها. حدد كل واحدة دخلت/خرجت من أنهي حساب. الدفعات القديمة قبل البداية داخلة في الرصيد الافتتاحي ومش محتاجة تحديد.
          </p>
          <ul className="divide-y divide-hairline">
            {o.unattributed.slice(0, 50).map((p) => (
              <li key={`${p.side}:${p.id}`} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm">
                    <span className={cn("font-semibold", p.side === "in" ? "text-green-ink" : "")}>{p.side === "in" ? "دخل" : "خرج"}</span> · {p.label}
                    <span className="block text-xs text-graphite">
                      {formatDateAr(p.date)} · {PAYMENT_METHOD_LABELS[p.method]}
                    </span>
                  </p>
                  <span className="tabular shrink-0 font-display font-semibold">{egp(p.amount)}</span>
                </div>
                <AttributeForm side={p.side} paymentId={p.id} accounts={active} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Tools: closed by default so the numbers above stay the page. */}
      <section aria-labelledby="tools-h" className="space-y-2.5">
        <h2 id="tools-h" className="font-display text-[1.1rem] font-semibold">
          {o.accounts.length === 0 ? "ابدأ الخزنة" : "أدوات الخزنة"}
        </h2>
        {active.length > 0 && (
          <>
            <ToolPanel icon={ArrowLeftRight} title="حركة على الحسابات" hint="تحويل بين حساباتك، إيداع أو سحب من صاحب الشغل، أو تصحيح بسبب.">
              <MovementForm accounts={active} today={today} />
            </ToolPanel>
            <ToolPanel icon={Scale} title="جرد حساب" hint="اكتب اللي عدّيته فعلًا — البرنامج يقارنه بالرصيد المسجل ويسجّل الفرق.">
              <ReconcileForm accounts={active} today={today} />
              {recs.length > 0 && (
                <>
                  <h3 className="mt-5 text-sm font-semibold">آخر الجرد</h3>
                  <ul className="mt-1 divide-y divide-hairline text-sm">
                    {recs.map((r) => (
                      <li key={r.id} className="flex justify-between gap-3 py-2">
                        <span className="min-w-0">
                          {r.accountName} · {formatDateAr(r.date)}
                          <span className="block text-xs text-graphite">
                            مسجل {egp(r.system)} · متعدّ {egp(r.counted)} · {r.recordedBy}
                          </span>
                        </span>
                        <span className={cn("tabular shrink-0 font-semibold", r.difference === "0.00" ? "text-success-ink" : "text-danger-ink")}>{r.difference === "0.00" ? "مطابق" : egp(r.difference)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </ToolPanel>
          </>
        )}
        <ToolPanel
          icon={PlusCircle}
          title={o.accounts.length === 0 ? "سجّل أول حساب ورصيده الافتتاحي" : "إضافة حساب"}
          hint="خزنة، حساب بنكي أو محفظة — بالرصيد اللي عدّيته فعلًا."
          open={o.accounts.length === 0}
        >
          {o.accounts.length === 0 && (
            <ol className="mb-4 list-decimal space-y-1 ps-5 text-sm text-graphite">
              <li>اختار يوم الجرد، وحدد الجرد كان بداية اليوم (قبل أي فلوس تتحرك) ولا آخره (بعد آخر حركة).</li>
              <li>عدّ الكاش اللي في الخزنة فعلًا.</li>
              <li>راجع رصيد البنك والمحافظ من الكشف أو التطبيق.</li>
              <li>سجّل كل حساب برصيده في التاريخ ده.</li>
              <li>من بعدها، كل دفعة جديدة بتتسجل على الحساب اللي دخلت فيه أو خرجت منه.</li>
              <li>الدفعات اللي قبل الجرد (ودفعات نفس اليوم لو الجرد آخر اليوم) جوّه الرصيد اللي عدّيته ومش هتتحسب تاني.</li>
            </ol>
          )}
          <AccountSetupForm today={today} />
        </ToolPanel>
      </section>

      <p className="flex items-center justify-center gap-1 text-xs text-graphite">
        <Wallet className="size-3.5" aria-hidden="true" />
        للمدير بس. التقارير القديمة زي ما هي.{" "}
        <Link href={`/accounts?${new URLSearchParams(periodParams(period))}`} className="inline-flex items-center underline">
          الحسابات
          <ChevronLeft className="size-3" aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}
