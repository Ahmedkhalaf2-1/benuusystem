import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ChevronLeft, HardHat } from "lucide-react";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { Caveat, egp } from "@/components/reports/report-ui";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { formatMoney, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getWorkerObligations } from "@/server/services/reports-service";

export const metadata: Metadata = { title: "أجور العمال" };

export default async function WorkerObligationsPage() {
  const user = await requirePermission("workers:view-pay");
  const w = await getWorkerObligations(prisma, user);
  const t = w.totals;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FlowHeader icon={HardHat} hue="rose" title="أجور العمال" context={`لحد ${formatDateAr(w.asOf)}`} backHref="/accounts" backLabel="الحسابات" />

      <section className="rounded-2xl bg-panel p-5 text-on-panel">
        <p className="text-sm text-on-panel-muted">مستحقات العمال (اتكسبت ولسه متدفعتش)</p>
        <p className="tabular font-display text-[2rem] leading-tight font-semibold" data-testid="w-owed">{egp(t.owedToWorkers)}</p>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
          {[
            { l: "اتكسب يوميات", v: t.earned },
            { l: "اتدفع يوميات", v: t.wagesPaid },
            { l: "اتدفع سلف", v: t.advancesPaid },
          ].map((x) => (
            <div key={x.l} className="rounded-2xl bg-panel-2 px-3 py-2.5 ring-1 ring-panel-line">
              <dt className="text-[0.7rem] text-on-panel-muted">{x.l}</dt>
              <dd className="tabular font-display font-semibold">{egp(x.v)}</dd>
            </div>
          ))}
        </dl>
        {toCents(t.advancesOutstanding) > 0n && <p className="mt-3 text-sm text-on-panel-muted">سلف لسه متخصمتش: {egp(t.advancesOutstanding)}</p>}
      </section>
      <Caveat>
        اليومية بتتحسب كاملة على كل يوم حضور، حتى لو الإنتاج أقل من المستهدف. حساب العامل = اللي اتكسب − كل اللي اتدفعله (يوميات + سلف). السلفة فلوس خرجت مقدمًا، ولما العامل يشتغل بيها مفيش فلوس بتخرج تاني ولا تكلفة بتتكرر.
      </Caveat>

      <FlowCard title="كل عامل">
        {w.workers.length === 0 ? (
          <p className="text-sm text-graphite">لسه مفيش عمال.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {w.workers.map((x) => {
              const bal = toCents(x.balance);
              return (
                <li key={x.id}>
                  <Link href={`/workers/${x.id}`} className="block py-3 hover:text-violet">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-semibold">{x.name}{!x.isActive && <span className="ms-1.5 text-xs text-graphite">(موقوف)</span>}</span>
                      <span className="flex items-center gap-1.5">
                        <b className={cn("tabular font-display", bal > 0n ? "text-violet" : bal < 0n ? "text-amber-ink" : "text-graphite")}>
                          {bal < 0n ? `سلفة ${formatMoney(-bal)}` : egp(x.balance)}
                        </b>
                        <ChevronLeft className="size-4 text-graphite" aria-hidden="true" />
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-graphite">
                      اتكسب {egp(x.earned)} · يوميات اتدفعت {egp(x.wagesPaid)} · سلف {egp(x.advancesPaid)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </FlowCard>
      <Link href="/workers/summary" className="flex h-13 items-center justify-between rounded-2xl bg-surface px-4 font-semibold border border-line hover:border-line-strong">
        <span className="flex items-center gap-2"><BarChart3 className="size-5 text-rose-ink" aria-hidden="true" />حساب العمال شهر بشهر</span>
        <ChevronLeft className="size-4 text-graphite" aria-hidden="true" />
      </Link>
    </div>
  );
}
