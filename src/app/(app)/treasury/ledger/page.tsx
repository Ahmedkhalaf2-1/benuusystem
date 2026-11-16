import type { Metadata } from "next";
import Link from "next/link";
import { Flash } from "@/components/flash";
import { BackLink } from "@/components/page-header";
import { egp } from "@/components/reports/report-ui";
import { NativeSelect } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VoidMovementForm } from "@/components/treasury/treasury-forms";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateAr, isValidDateString, monthRange, todayDateString } from "@/lib/dates";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { getLedger, getTreasuryOverview } from "@/server/services/treasury-service";

export const metadata: Metadata = { title: "سجل حركات الخزنة" };

export default async function TreasuryLedgerPage(props: PageProps<"/treasury/ledger">) {
  const user = await requirePermission("treasury:manage");
  const sp = await props.searchParams;
  const today = todayDateString();
  const month = monthRange(today);
  const pick = (v: unknown, d: string) => (typeof v === "string" && isValidDateString(v) ? v : d);
  let from = pick(sp.from, month.from);
  let to = pick(sp.to, today);
  if (from > to) [from, to] = [to, from];
  const overview = await getTreasuryOverview(prisma, user, { from, to });
  const accountId = typeof sp.account === "string" && overview.accounts.some((a) => a.id === sp.account) ? sp.account : null;
  const ledger = await getLedger(prisma, user, { accountId, from, to });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Flash message={sp.saved === "voided" ? "اتلغت الحركة (فاضلة في السجل) ✓" : undefined} />
      <BackLink href="/treasury" label="الخزنة والحسابات" />
      <h1 className="font-display text-[1.6rem] font-semibold">سجل حركات الخزنة</h1>

      <form className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-4" method="get">
        <NativeSelect name="account" defaultValue={accountId ?? ""} aria-label="الحساب" className="col-span-2 sm:col-span-1">
          <option value="">كل الحسابات</option>
          {overview.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" name="from" defaultValue={from} max={today} aria-label="من" />
        <Input type="date" name="to" defaultValue={to} max={today} aria-label="إلى" />
        <Button type="submit" className="col-span-2 h-12 rounded-xl sm:col-span-1">
          عرض
        </Button>
      </form>

      {!overview.complete && <p className="rounded-2xl bg-warning-soft p-3 text-sm font-semibold text-warning-ink">الرصيد غير مكتمل — محتاج رصيد افتتاحي ومراجعة الحركات</p>}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="ledger-summary">
        {[
          { label: "رصيد أول الفترة", value: ledger.opening },
          { label: "دخل", value: ledger.totalIn },
          { label: "خرج", value: ledger.totalOut },
          { label: "رصيد آخر الفترة", value: ledger.closing },
        ].map((m) => (
          <div key={m.label} className="rounded-2xl border border-line bg-surface p-3">
            <dt className="text-xs text-graphite">{m.label}</dt>
            <dd className="tabular mt-0.5 font-display font-semibold">{m.value === null ? "غير معروف" : egp(m.value)}</dd>
          </div>
        ))}
      </dl>
      {!accountId && <p className="text-xs text-graphite">التحويلات بين حساباتك ظاهرة كـ«داخلي» ومش داخلة في الدخل والخرج — إجمالي الفلوس مبيتغيرش بيها.</p>}

      {ledger.rows.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-line-strong bg-surface p-6 text-center text-sm text-graphite">مفيش حركات في الفترة دي.</p>
      ) : (
        <>
          {/* Desktop: a statement table with aligned money columns. */}
          <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface lg:block">
            <table className="w-full text-sm" data-testid="ledger-table">
              <caption className="sr-only">حركات الخزنة من {formatDateAr(from)} إلى {formatDateAr(to)}</caption>
              <thead className="bg-well text-xs text-graphite">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">التاريخ</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">البيان</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">الحساب</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-semibold">دخل</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-semibold">خرج</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-semibold">الرصيد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {ledger.rows.map((r) => (
                  <tr key={r.key} className={cn("align-top", r.internal && "bg-well/50")}>
                    <td className="px-4 py-3 whitespace-nowrap text-graphite">{formatDateAr(r.date)}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">
                        {r.href ? (
                          <Link href={r.href} className="hover:text-brand">
                            {r.reference}
                          </Link>
                        ) : (
                          r.reference
                        )}
                      </span>
                      {r.internal && <span className="ms-1.5 rounded-full bg-surface px-2 py-0.5 text-[0.68rem] font-semibold text-graphite ring-1 ring-line">داخلي</span>}
                      {(r.notes || r.recordedBy) && (
                        <span className="block text-xs text-graphite">
                          {r.notes}
                          {r.notes && r.recordedBy && " · "}
                          {r.recordedBy && `سجّلها ${r.recordedBy}`}
                        </span>
                      )}
                      {r.movementId && <VoidMovementForm id={r.movementId} />}
                    </td>
                    <td className="px-4 py-3 text-graphite">
                      {r.accountName}
                      {r.otherAccountName && ` ← ${r.otherAccountName}`}
                    </td>
                    <td className="tabular px-4 py-3 text-end font-semibold text-success-ink">{!r.internal && r.moneyIn !== "0.00" ? egp(r.moneyIn) : ""}</td>
                    <td className="tabular px-4 py-3 text-end font-semibold">{!r.internal && r.moneyOut !== "0.00" ? egp(r.moneyOut) : ""}</td>
                    <td className="tabular px-4 py-3 text-end whitespace-nowrap">
                      {r.internal && <span className="block text-xs text-graphite">{egp(r.moneyIn)}</span>}
                      {r.balance === null ? <span className="text-xs text-graphite">غير معروف</span> : egp(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones and tablets: one card row per movement. */}
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-line bg-surface lg:hidden">
          {ledger.rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid="ledger-row">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {r.href ? (
                    <Link href={r.href} className="hover:text-violet">
                      {r.reference}
                    </Link>
                  ) : (
                    r.reference
                  )}
                  {r.internal && <span className="ms-1.5 rounded-full bg-well px-2 py-0.5 text-[0.68rem] font-semibold text-graphite">داخلي</span>}
                </p>
                <p className="text-xs text-graphite">
                  {formatDateAr(r.date)} · {r.accountName}
                  {r.otherAccountName && ` ← ${r.otherAccountName}`}
                  {r.recordedBy && ` · ${r.recordedBy}`}
                </p>
                {r.notes && <p className="mt-0.5 text-xs">{r.notes}</p>}
                {r.movementId && <VoidMovementForm id={r.movementId} />}
              </div>
              <div className="tabular text-end text-sm">
                {r.internal ? (
                  <p className="font-semibold text-graphite">{egp(r.moneyIn)}</p>
                ) : (
                  <p className={cn("font-display font-semibold", r.moneyIn !== "0.00" ? "text-green-ink" : "")}>
                    {r.moneyIn !== "0.00" ? `+ ${egp(r.moneyIn)}` : `− ${egp(r.moneyOut)}`}
                  </p>
                )}
                <p className="text-xs text-graphite">{r.balance === null ? "الرصيد غير معروف" : `الرصيد ${egp(r.balance)}`}</p>
              </div>
            </li>
          ))}
          </ul>
        </>
      )}
    </div>
  );
}
