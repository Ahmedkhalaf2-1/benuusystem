import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, ChevronLeft, ChevronRight, ClipboardList, Landmark, Receipt, Scale } from "lucide-react";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { Flash } from "@/components/flash";
import { ConfirmMonthForm, GenerateFixedForm, ReopenMonthForm } from "@/components/finance/monthly-close-forms";
import { Caveat, egp } from "@/components/reports/report-ui";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, formatDateTimeAr, todayDateString } from "@/lib/dates";
import { COST_STATUS_LABELS } from "@/lib/finance/cost-review-labels";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";
import { BASIS_LABELS, isValidMonth, PROVISIONAL_LABELS, shiftMonth } from "@/lib/finance/profitability";
import { centsToDecimalString, toCents } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { closeWarnings, getMonthlyClosing } from "@/server/services/profitability-service";

export const metadata: Metadata = { title: "قفل الشهر" };

const FLASH: Record<string, string> = { confirmed: "اتأكدت مراجعة الشهر ✓", reopened: "الشهر اتفتح للمراجعة ✓", fixed: "اتسجلت المصاريف الثابتة للشهر ✓" };
const RESTATEMENT_LABELS = {
  PAYMENT_VOIDED: "دفعات عملاء اتلغت",
  SUPPLIER_PAYMENT_VOIDED: "مدفوعات اتلغت",
  COST_AMENDED: "تكاليف اتعدلت",
  COST_VOIDED: "تكاليف اتلغت",
  ORDER_PRICE_CHANGED: "أسعار أوردرات اتغيرت",
  ORDER_STATUS_CHANGED: "حالة أوردرات اتغيرت",
  DELIVERY_VOIDED: "تسليمات اتلغت",
} as const;
const PAY_LABELS = { PAID: "مدفوع", PARTIAL: "مدفوع جزء", UNPAID: "مش مدفوع", NONE: "—" } as const;
const SNAPSHOT_LABELS: Record<string, string> = {
  basis: "أساس الاعتراف",
  orders: "عدد الأوردرات",
  revenue: "الإيراد",
  directCosts: "التكاليف المباشرة",
  grossProfit: "مجمل الربح",
  cancelledOrderCosts: "تكاليف أوردرات ملغية",
  cancelledOrderLabor: "أجور أوردرات ملغية",
  operatingExpenses: "مصاريف تشغيل",
  fixedExpenses: "مصاريف ثابتة",
  unallocatedLabor: "أجور مش موزعة",
  netOperatingProfit: "صافي ربح التشغيل",
  draftCosts: "تكاليف مسودة",
  customerCollections: "تحصيلات العملاء",
  supplierPayments: "مدفوعات الموردين",
  receivables: "لينا عند العملاء",
  supplierPayables: "علينا للموردين",
  treasuryClosing: "رصيد الخزنة آخر الشهر",
};

function Row({ label, value, strong, minus, tone, testId, note }: { label: string; value: string; strong?: boolean; minus?: boolean; tone?: string; testId?: string; note?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5", strong && "border-t border-hairline pt-2.5")}>
      <dt className={cn("text-sm", strong ? "font-semibold" : "text-graphite")}>
        {minus && "− "}
        {label}
        {note && <span className="block text-xs font-normal text-graphite">{note}</span>}
      </dt>
      <dd className={cn("tabular shrink-0 font-display", strong ? "text-lg font-semibold" : "font-medium", tone)} data-testid={testId}>
        {egp(value)}
      </dd>
    </div>
  );
}

function profitTone(v: string) {
  return toCents(v) < 0n ? "text-danger-ink" : "text-success-ink";
}

/** «قفل الشهر» — the owner's monthly results, treasury reconciliation and review. */
export default async function MonthlyClosingPage(props: PageProps<"/accounts/monthly">) {
  const user = await requirePermission("finance:reports");
  await requirePermission("treasury:manage");
  const sp = await props.searchParams;
  const today = todayDateString();
  const defaultMonth = shiftMonth(today.slice(0, 7), -1);
  const month = isValidMonth(sp.month) ? sp.month : defaultMonth;
  const basis = sp.basis === "BOOKING" ? "BOOKING" : "DELIVERY";
  const departments = await prisma.department.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const departmentId = typeof sp.department === "string" && departments.some((d) => d.id === sp.department) ? sp.department : null;
  const m = await getMonthlyClosing(prisma, user, { month, basis, departmentId });
  const warnings = closeWarnings(m);
  const canRecord = hasPermission(user, "expenses:record");
  const href = (over: Record<string, string | null>) => {
    const qs = new URLSearchParams();
    const v = { month, basis: basis === "BOOKING" ? "BOOKING" : null, department: departmentId, ...over };
    for (const [k, val] of Object.entries(v)) if (val) qs.set(k, val);
    return `/accounts/monthly?${qs.toString()}`;
  };
  const t = m.treasury;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Flash message={typeof sp.saved === "string" ? FLASH[sp.saved] : undefined} />
      <FlowHeader icon={CalendarCheck} hue="violet" title="قفل الشهر" backHref="/accounts" backLabel="الحسابات" context="الإيراد والتكاليف والربح، التحصيلات والمدفوعات، ورصيد الخزنة أول وآخر الشهر" />

      {/* Period, basis, department */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ month: shiftMonth(month, -1) })} className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-surface" aria-label="الشهر اللي قبله">
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
        <form action="/accounts/monthly" className="flex flex-wrap items-center gap-2">
          <input type="month" name="month" defaultValue={month} className="h-10 rounded-xl border border-line bg-surface px-3" aria-label="الشهر" />
          <select name="basis" defaultValue={basis} className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" aria-label="أساس الاعتراف بالإيراد">
            <option value="DELIVERY">الإيراد {BASIS_LABELS.DELIVERY}</option>
            <option value="BOOKING">الإيراد {BASIS_LABELS.BOOKING}</option>
          </select>
          <select name="department" defaultValue={departmentId ?? ""} className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" aria-label="القسم">
            <option value="">كل الشركة</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                قسم {d.name}
              </option>
            ))}
          </select>
          <button type="submit" className="h-10 rounded-xl bg-brand-solid px-4 text-sm font-semibold text-white">
            عرض
          </button>
        </form>
        <Link href={href({ month: shiftMonth(month, 1) })} className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-surface" aria-label="الشهر اللي بعده">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <Caveat>
        {basis === "DELIVERY"
          ? "الأوردر بيتحسب إيراده وكل تكاليفه في الشهر اللي اتسلم فيه آخر جزء منه. الأوردرات اللي لسه شغالة مش داخلة في أي شهر لحد ما تتسلم."
          : "عرض إداري مبدئي: الأوردر بيتحسب في شهر استلامه حتى لو لسه متسلمش. مش هو الأساس الرسمي، ومينفعش يتأكد عليه."}{" "}
        المصاريف العامة بتاريخ المصروف. التحصيلات والمدفوعات بتاريخ الدفع. الدفع للمورد مش بيتخصم من الربح تاني.
      </Caveat>
      {!m.monthEnded && <Caveat tone="warn">الشهر ده لسه مخلصش — الأرقام بتتغير، والتأكيد متاح بعد ما يخلص.</Caveat>}
      {departmentId && (
        <Caveat tone="warn">
          عرض قسم: الإيراد = نصيب القسم من قيمة كل أوردر (نفس قاعدة توزيع الأقسام). التكاليف = اللي متسجلة على القسم أو على بنوده، وتكاليف الأوردر كله لو الأوردر كله تبع القسم. المصاريف العامة والخزنة على مستوى الشركة بس ومش ظاهرة هنا.
        </Caveat>
      )}

      {/* Profit & loss */}
      <FlowCard title="نتيجة الشهر" icon={Scale}>
        <dl data-testid="monthly-pnl">
          <Row label="إيراد الأوردرات المعترف بيها" value={m.pnl.revenue} testId="m-revenue" note={`${m.orders.length} أوردر`} />
          <Row label="خامات وتغليف" value={m.pnl.materials} minus />
          <Row label="تشغيل وورش خارجية" value={m.pnl.production} minus />
          <Row label="أجور العمال الموزعة على الأوردرات" value={m.pnl.labor} minus />
          <Row label="تكاليف مباشرة تانية" value={m.pnl.otherDirect} minus />
          <Row label="إجمالي التكاليف المباشرة" value={m.pnl.directCosts} strong testId="m-direct" />
          <Row label={`مجمل الربح${m.pnl.grossMargin ? ` (${m.pnl.grossMargin}%)` : ""}`} value={m.pnl.grossProfit} strong tone={profitTone(m.pnl.grossProfit)} testId="m-gross" />
          {!departmentId && (
            <>
              <Row label="خسائر أوردرات ملغية" value={m.pnl.cancellationLosses} minus testId="m-cancel" note={`تكاليف ${egp(m.pnl.cancelledOrderCosts)} بتاريخ التكلفة + أجور ${egp(m.pnl.cancelledOrderLabor)} بتاريخ الشغل`} />
              <Row label="مصاريف تشغيل عامة" value={m.pnl.operatingExpenses} minus testId="m-opex" />
              <Row label="مصاريف ثابتة" value={m.pnl.fixedExpenses} minus testId="m-fixed" />
              <Row label="أجور عمال مش موزعة على أوردرات" value={m.pnl.unallocatedLabor} minus note="يوميات من غير شغل متسجل على أوردر" />
            </>
          )}
          <Row label={`${departmentId ? "مجمل ربح القسم" : "صافي ربح التشغيل"}${m.pnl.netMargin ? ` (${m.pnl.netMargin}%)` : ""}`} value={m.pnl.netOperatingProfit} strong tone={profitTone(m.pnl.netOperatingProfit)} testId="m-net" />
        </dl>
        <div className="mt-3 space-y-2 text-sm">
          {toCents(m.pnl.draftCosts) > 0n && <Caveat tone="warn">تكاليف مسودة بـ {egp(m.pnl.draftCosts)} على أوردرات الشهر مش داخلة في الربح لسه.</Caveat>}
          {toCents(m.pnl.deferredCosts) > 0n && <Caveat>تكاليف بـ {egp(m.pnl.deferredCosts)} اتسجلت الشهر ده على أوردرات لسه متسلمتش أو اتسلمت في شهر تاني — بتتحسب مع أوردرها.</Caveat>}
          {m.pnl.unallocatedOrders ? (
            <Caveat tone="warn">
              {m.pnl.unallocatedOrders} أوردر في الشهر بقيمة {egp(m.pnl.unallocatedRevenue ?? "0")} مش متوزعة على قسم بشكل موثوق (سعر واحد للأوردر كله، أو بند من غير سعر) — مش محسوبة على أي قسم. بتظهر في عرض «كل الشركة».
            </Caveat>
          ) : null}
          {m.pnl.unattributedCosts && toCents(m.pnl.unattributedCosts) > 0n && <Caveat tone="warn">تكاليف بـ {egp(m.pnl.unattributedCosts)} على أوردرات مشتركة مش متحددة لأي قسم — مش محسوبة على القسم ده.</Caveat>}
        </div>
      </FlowCard>

      {!departmentId && (
        <FlowCard title="مراجعة الأجور والتسويات" icon={Scale}>
          <dl data-testid="labor-check">
            <Row label="يوميات الشهر كلها (بتاريخ الشغل)" value={m.laborCheck.earned} strong />
            <Row label="على أوردرات اتحسبت الشهر ده (جوه التكاليف المباشرة)" value={m.laborCheck.withOrdersThisMonth} />
            <Row label="على أوردرات ملغية (خسارة)" value={m.laborCheck.cancelled} />
            <Row label="مش موزعة على أوردر (مصروف)" value={m.laborCheck.unallocated} />
            <Row label="على أوردرات بتتحسب في شهر تاني" value={m.laborCheck.deferred} note="بتدخل في تكاليف الأوردر في شهر تسليمه" />
          </dl>
          {m.unresolved.length > 0 && (
            <div className="mt-3 space-y-1" data-testid="unresolved">
              <Caveat tone="warn">فلوس عملاء محتاجة قرار (مفيش استرداد متسجل في السيستم — محدش غيّر أي دفعة):</Caveat>
              <ul className="text-sm">
                {m.unresolved.map((u) => (
                  <li key={u.orderId} className="flex justify-between py-1">
                    <Link href={`/orders/${u.orderId}`} className="hover:underline">
                      <span dir="ltr" className="tabular">{formatOrderNumber(u.number)}</span> {u.title} — {u.kind === "OVERPAID" ? "مدفوع أكتر من سعره" : "ملغي واتدفع عليه"}
                    </Link>
                    <span className="tabular">{egp(u.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {m.restatements.length > 0 && (
            <div className="mt-3">
              <Caveat>
                أرقام الشهر ده اتعدلت بتصحيحات اتعملت بعد ما خلص (كل تصحيح متسجل بسببه ومين عمله):{" "}
                {m.restatements.map((r) => `${RESTATEMENT_LABELS[r.kind]} (${r.count})`).join("، ")}.
              </Caveat>
            </div>
          )}
        </FlowCard>
      )}

      {/* Cash & balances */}
      <div className="grid gap-4 md:grid-cols-2">
        <FlowCard title="الفلوس اللي اتحركت في الشهر" icon={Receipt}>
          <dl>
            <Row label={`تحصيلات العملاء (${m.cash.collectionsCount} دفعة)`} value={m.cash.customerCollections} testId="m-collections" />
            <Row label="مدفوعات للموردين" value={m.cash.supplierPayments} testId="m-supplier-paid" />
            <Row label="مدفوعات مصاريف" value={m.cash.expensePayments} />
            <Row label="مدفوعات للعمال (يوميات وسلف)" value={m.cash.workerPayments} />
          </dl>
          <p className="mt-2 text-xs text-graphite">ده كاش فعلي — مش إيراد ومش تكلفة.</p>
        </FlowCard>
        <FlowCard title="المستحقات آخر الشهر" icon={Landmark}>
          <dl>
            <Row label="لينا عند العملاء" value={m.balances.receivables} testId="m-receivables" />
            <Row label="علينا للموردين" value={m.balances.supplierPayables} testId="m-payables" />
            <Row label="تكاليف من غير مورد لسه متدفعتش" value={m.balances.looseCostPayables} />
            <Row label="مصاريف لسه متدفعتش" value={m.balances.expensePayables} />
            <Row label="مستحقات العمال" value={m.balances.workersOwed} />
          </dl>
        </FlowCard>
      </div>

      {/* Treasury */}
      {t && (
        <FlowCard title="الخزنة: أول الشهر وآخره" icon={Landmark}>
          {!t.available ? (
            <p className="rounded-2xl bg-well p-4 text-sm text-graphite">مفيش حساب خزنة رصيده معروف في الشهر ده (الخزنة اتعملت بعده).</p>
          ) : (
            <div className="space-y-3" data-testid="monthly-treasury">
              <dl>
                <Row label="رصيد أول الشهر" value={t.opening} strong testId="t-opening" />
                {toCents(t.newAccountsOpening) > 0n && <Row label="أرصدة افتتاحية لحسابات اتفتحت في الشهر" value={t.newAccountsOpening} />}
                <Row label="تحصيلات العملاء" value={t.customerCollections} />
                <Row label="إيداعات صاحب الشغل" value={t.capitalIn} />
                <Row label="تصحيحات جرد (زيادة) وداخل تاني" value={centsSum(t.adjustmentsIn, t.otherIn)} />
                <Row label="مدفوعات الموردين" value={t.supplierPayments} minus />
                <Row label="مدفوعات المصاريف" value={t.expensePayments} minus />
                <Row label="مدفوعات العمال" value={t.workerPayments} minus />
                <Row label="مسحوبات صاحب الشغل" value={t.drawings} minus />
                <Row label="تصحيحات جرد (نقص) وخارج تاني" value={centsSum(t.adjustmentsOut, t.otherOut)} minus />
                <Row label="رصيد آخر الشهر (محسوب)" value={t.calculatedClosing} strong testId="t-calculated" />
                <Row label="رصيد آخر الشهر (من دفتر الخزنة)" value={t.ledgerClosing} testId="t-ledger" />
              </dl>
              {toCents(t.internalTransfers) > 0n && <p className="text-xs text-graphite">تحويلات بين حساباتك بـ {egp(t.internalTransfers)} — مش داخلة في الداخل ولا الخارج.</p>}
              {toCents(t.discrepancy) !== 0n ? (
                <Caveat tone="warn">فرق بين الحساب والدفتر: {egp(t.discrepancy)} — راجع الحركات. محدش عدّل الرصيد تلقائي.</Caveat>
              ) : (
                <p className="text-sm font-semibold text-success-ink" data-testid="t-reconciled">
                  الرصيد المحسوب مطابق لدفتر الخزنة ✓
                </p>
              )}
              {t.unattributed.count > 0 && (
                <Caveat tone="warn">
                  {t.unattributed.count} دفعة بـ {egp(t.unattributed.total)} في الشهر مش متحدد حسابها — مش داخلة في رصيد الخزنة.{" "}
                  <Link href="/treasury" className="font-semibold underline">
                    حددها
                  </Link>
                </Caveat>
              )}
              {t.openCounts.map((c) => (
                <Caveat key={`${c.accountName}-${c.date}`} tone="warn">
                  جرد {c.accountName} يوم {formatDateAr(c.date)}: العدّ {egp(c.counted)} والدفتر {egp(c.system)} — فرق {egp(c.difference)} لسه متسوّاش.
                </Caveat>
              ))}
              <ul className="divide-y divide-line rounded-2xl border border-line text-sm">
                {t.accounts.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-2 px-3 py-2">
                    <span>{a.name}</span>
                    <span className="tabular text-graphite">
                      {a.opening === null ? "اتفتح في الشهر" : egp(a.opening)} ← <span className="font-semibold text-ink">{egp(a.closing)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FlowCard>
      )}

      {/* Orders */}
      <FlowCard title={`أوردرات الشهر (${m.orders.length})`} icon={ClipboardList}>
        {m.orders.length === 0 ? (
          <p className="rounded-2xl bg-well p-4 text-sm text-graphite">مفيش أوردرات معترف بيها في الشهر ده على الأساس ده.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="monthly-orders">
              <thead>
                <tr className="text-start text-xs text-graphite">
                  <th className="px-1 py-2 text-start font-medium">الأوردر</th>
                  <th className="px-1 py-2 text-start font-medium">العميل</th>
                  <th className="px-1 py-2 text-end font-medium">الإيراد</th>
                  <th className="px-1 py-2 text-end font-medium">التكاليف</th>
                  <th className="px-1 py-2 text-end font-medium">الربح</th>
                  <th className="px-1 py-2 text-end font-medium">الهامش</th>
                  <th className="px-1 py-2 text-start font-medium">الدفع</th>
                  <th className="px-1 py-2 text-start font-medium">التكاليف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {m.orders.map((o) => (
                  <tr key={o.orderId} className="align-top">
                    <td className="px-1 py-2">
                      <Link href={`/costs/orders/${o.orderId}`} className="font-semibold text-violet hover:underline">
                        <span dir="ltr" className="tabular">{formatOrderNumber(o.number)}</span> {o.title}
                      </Link>
                      {(o.provisional || o.splitUnreliable) && (
                        <span className="block text-xs text-warning-ink" title={o.reasons.map((r) => PROVISIONAL_LABELS[r]).join("، ")}>
                          {o.provisional ? "مبدئي" : ""}
                          {o.splitUnreliable ? " · تكاليف مشتركة مش متقسمة" : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-2">{o.customerName}</td>
                    <td className="tabular px-1 py-2 text-end">{egp(o.revenue)}</td>
                    <td className="tabular px-1 py-2 text-end">{egp(o.directCosts)}</td>
                    <td className={cn("tabular px-1 py-2 text-end font-semibold", profitTone(o.grossProfit))}>{egp(o.grossProfit)}</td>
                    <td className="tabular px-1 py-2 text-end">{o.margin === null ? "—" : `${o.margin}%`}</td>
                    <td className="px-1 py-2">{PAY_LABELS[o.paymentStatus]}</td>
                    <td className="px-1 py-2 text-xs">{COST_STATUS_LABELS[o.costStatus ?? "LEGACY"]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FlowCard>

      {/* Expenses */}
      {!departmentId && (
        <FlowCard title={`مصاريف الشهر (${m.expenses.length})`} icon={Receipt}>
          {m.checks.fixedNotGenerated > 0 && canRecord && (
            <div className="mb-3 space-y-2">
              <Caveat tone="warn">{m.checks.fixedNotGenerated} مصروف ثابت ميعاده جه ولسه متسجلش للشهر ده.</Caveat>
              <GenerateFixedForm month={month} basis={basis} count={m.checks.fixedNotGenerated} />
            </div>
          )}
          {m.expenses.length === 0 ? (
            <p className="rounded-2xl bg-well p-4 text-sm text-graphite">مفيش مصاريف متسجلة في الشهر ده.</p>
          ) : (
            <ul className="divide-y divide-line">
              {m.expenses.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-2 py-2 text-sm">
                  <Link href={`/expenses/${e.id}`} className="min-w-0 hover:underline">
                    <span className="font-semibold">{EXPENSE_CATEGORY_LABELS[e.category]}</span>
                    {e.isFixed && <span className="ms-1 rounded-full bg-well px-2 py-0.5 text-xs text-graphite">ثابت</span>}
                    {e.description && <span className="text-graphite"> · {e.description}</span>}
                    <span className="block text-xs text-graphite">
                      {formatDateAr(e.date)} · اتدفع {egp(e.paid)}
                    </span>
                  </Link>
                  <span className="tabular shrink-0 font-display font-semibold">{egp(e.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-graphite">
            <Link href="/expenses/recurring" className="font-semibold text-violet hover:underline">
              المصاريف الثابتة المتكررة
            </Link>{" "}
            · تكاليف الأوردرات مش بتتسجل هنا تاني.
          </p>
          {m.cancelledCosts.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-semibold">خسائر أوردرات ملغية</p>
              <ul className="text-sm">
                {m.cancelledCosts.map((c) => (
                  <li key={c.orderId} className="flex justify-between py-1">
                    <Link href={`/costs/orders/${c.orderId}`} className="hover:underline">
                      <span dir="ltr" className="tabular">{formatOrderNumber(c.number)}</span> {c.title}
                    </Link>
                    <span className="tabular text-end">
                      {egp(c.amount)}
                      <span className="block text-xs text-graphite">تكاليف {egp(c.costs)} · أجور {egp(c.labor)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FlowCard>
      )}

      {/* Review */}
      {!departmentId && (
        <FlowCard title="مراجعة الشهر" icon={CalendarCheck}>
          <div className="space-y-3" data-testid="month-review">
            <p className="text-sm">
              الحالة:{" "}
              <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", m.close.status === "CONFIRMED" ? "bg-success-soft text-success-ink" : m.close.status === "CHANGED" ? "bg-danger-soft text-danger-ink" : "bg-warning-soft text-warning-ink")} data-testid="close-status">
                {m.close.status === "CONFIRMED" ? "متأكد" : m.close.status === "CHANGED" ? "متأكد — بس الأرقام اتغيرت بعدها" : m.close.status === "REOPENED" ? "اتفتح للمراجعة" : "لسه متراجعش"}
              </span>
              {m.close.confirmedAt && (
                <span className="ms-2 text-graphite">
                  آخر تأكيد: {m.close.confirmedBy}، {formatDateTimeAr(m.close.confirmedAt)}
                </span>
              )}
            </p>
            {m.close.changes.length > 0 && (
              <div className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">
                <p className="font-semibold">اتغير بعد التأكيد (تعديل تكاليف، دفعة، أو تسليم متأخر):</p>
                <ul className="mt-1 space-y-0.5">
                  {m.close.changes.map((c) => (
                    <li key={c.key}>
                      {SNAPSHOT_LABELS[c.key] ?? c.key}: {String(c.confirmed ?? "—")} ← {String(c.now ?? "—")}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">راجع التغيير وأكّد الشهر تاني — التأكيد القديم محفوظ في السجل.</p>
              </div>
            )}
            {warnings.length > 0 ? (
              <ul className="list-inside list-disc space-y-0.5 rounded-xl bg-warning-soft p-3 text-sm text-warning-ink" data-testid="close-warnings">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-success-ink">مفيش تنبيهات على الشهر ده.</p>
            )}
            {m.checks.completedWithoutDelivery.length > 0 && (
              <p className="text-xs text-graphite">
                أوردرات مكتملة من غير تاريخ تسليم (مش داخلة في أي شهر):{" "}
                {m.checks.completedWithoutDelivery.map((o) => (
                  <Link key={o.id} href={`/orders/${o.id}`} className="me-2 underline">
                    {formatOrderNumber(o.number)}
                  </Link>
                ))}
              </p>
            )}
            <p className={cn("text-sm font-semibold", m.reconciled ? "text-success-ink" : "text-warning-ink")} data-testid="month-reconciled">
              {m.reconciled ? "الشهر متسوّي: الخزنة مطابقة ومفيش فلوس معلقة." : "الشهر مش متسوّي بالكامل — راجع التنبيهات."}
            </p>
            {basis === "BOOKING" ? (
              <Caveat>التأكيد بيتعمل على أساس التسليم الكامل بس. <Link href={href({ basis: null })} className="font-semibold underline">ارجع للأساس الرسمي</Link></Caveat>
            ) : m.close.status === "CONFIRMED" ? (
              <ReopenMonthForm month={month} basis={basis} version={m.close.version} />
            ) : (
              <ConfirmMonthForm month={month} basis={basis} version={m.close.version} warnings={warnings} disabledReason={m.monthEnded ? undefined : "التأكيد متاح بعد ما الشهر يخلص."} />
            )}
            <p className="text-xs text-graphite">التأكيد بيحفظ أرقام الشهر للمراجعة بس — مش بيقفل أي بيانات ولا بيعمل قيود تلقائية. أي تعديل بعده بيبان هنا كفرق.</p>
            {m.close.events.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-graphite">السجل ({m.close.events.length})</summary>
                <ul className="mt-2 space-y-1">
                  {m.close.events.map((e, i) => (
                    <li key={i} className="rounded-lg bg-well p-2 text-xs">
                      {formatDateTimeAr(e.at)} — {e.by}: {e.action === "CONFIRMED" ? "تأكيد" : "فتح للمراجعة"}
                      {e.reason && ` · ${e.reason}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </FlowCard>
      )}
    </div>
  );
}

function centsSum(a: string, b: string): string {
  return centsToDecimalString(toCents(a) + toCents(b));
}
