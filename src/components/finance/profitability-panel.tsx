import { TrendingDown, TrendingUp } from "lucide-react";
import { FlowCard } from "@/components/ds/primitives";
import { egp } from "@/components/reports/report-ui";
import { COST_STATUS_LABELS } from "@/lib/finance/cost-review-labels";
import { PROVISIONAL_LABELS } from "@/lib/finance/profitability";
import { toCents } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import type { OrderProfitabilityView } from "@/server/services/profitability-service";

function Line({ label, value, strong, tone, testId }: { label: string; value: string; strong?: boolean; tone?: string; testId?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5", strong && "border-t border-hairline pt-2.5")}>
      <dt className={cn("text-sm", strong ? "font-semibold" : "text-graphite")}>{label}</dt>
      <dd className={cn("tabular font-display", strong ? "text-lg font-semibold" : "font-medium", tone)} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** «ربحية الأوردر» — owner only. Sales, costs, profit and collections kept visibly apart. */
export function ProfitabilityPanel({ p }: { p: OrderProfitabilityView }) {
  const profit = toCents(p.grossProfit);
  const negative = profit < 0n;
  const Icon = negative ? TrendingDown : TrendingUp;
  return (
    <FlowCard title="ربحية الأوردر" icon={Icon}>
      <div className="space-y-3" data-testid="order-profitability">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">
            <span dir="ltr" className="tabular">{formatOrderNumber(p.number)}</span> · {p.title}
          </span>
          <span className={cn("ms-auto rounded-full px-3 py-1 text-xs font-semibold", p.provisional ? "bg-warning-soft text-warning-ink" : "bg-success-soft text-success-ink")} data-testid="profit-state">
            {p.provisional ? "ربح مبدئي" : "ربح نهائي"}
          </span>
        </div>

        <dl>
          <Line label="قيمة البيع (إيراد الأوردر)" value={egp(p.revenue)} testId="profit-revenue" />
          <Line label="خامات وتغليف" value={egp(p.materials)} />
          <Line label="تشغيل وورش خارجية (طباعة، تطريز، مصنعية)" value={egp(p.production)} />
          <Line label="أجور العمال الموزعة على الأوردر" value={egp(p.labor)} />
          <Line label="تكاليف مباشرة تانية (نقل، أخرى)" value={egp(p.otherDirect)} />
          <Line label="إجمالي التكاليف المباشرة المتسجلة" value={egp(p.directCosts)} strong testId="profit-costs" />
          <Line label="مجمل ربح الأوردر" value={egp(p.grossProfit)} strong tone={negative ? "text-danger-ink" : "text-success-ink"} testId="profit-gross" />
          <Line label="نسبة هامش الربح" value={p.margin === null ? "—" : `${p.margin}%`} testId="profit-margin" />
        </dl>

        {toCents(p.draftCosts) > 0n && (
          <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning-ink">
            فيه تكاليف مسودة بـ {egp(p.draftCosts)} مش داخلة في الربح لسه. لو اتسجلت زي ما هي، الربح هيبقى {egp(p.expectedProfit)}.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-2 rounded-2xl bg-well p-3 text-center">
          <div>
            <dt className="text-xs text-graphite">اتحصّل من العميل</dt>
            <dd className="tabular font-display font-semibold text-success-ink">{egp(p.collected)}</dd>
          </div>
          <div>
            <dt className="text-xs text-graphite">باقي على العميل</dt>
            <dd className="tabular font-display font-semibold" data-testid="profit-outstanding">{egp(p.outstanding)}</dd>
          </div>
        </dl>
        {toCents(p.overpaid) > 0n && <p className="text-sm text-danger-ink">العميل دافع أكتر من قيمة الأوردر بـ {egp(p.overpaid)} — محتاج قرار.</p>}

        <p className="text-sm">
          <span className="text-graphite">حالة مراجعة التكاليف: </span>
          <span className="font-semibold">{COST_STATUS_LABELS[p.costStatus ?? "LEGACY"]}</span>
        </p>
        {p.reasons.length > 0 && (
          <ul className="list-inside list-disc space-y-0.5 text-xs text-graphite">
            {p.reasons.map((r) => (
              <li key={r}>{PROVISIONAL_LABELS[r]}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-graphite">
          الربح هنا قبل المصاريف العامة (إيجار، كهرباء…). التكاليف المسودة مش محسوبة لحد ما تتقفل. الدفع للمورد بيقلل اللي علينا ورصيد الخزنة بس — مش بيتخصم من الربح تاني.
        </p>
      </div>
    </FlowCard>
  );
}
