import Link from "next/link";
import { HardHat } from "lucide-react";
import { formatDateAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { WORK_TYPE_LABELS, WORK_UNIT_LABELS } from "@/lib/workers/labels";
import type { OrderLabor } from "@/server/services/labor-service";

/** Internal labour of an order: shares of workers' daily wages (computed, never copied). */
export function OrderLaborSection({ labor }: { labor: OrderLabor }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <HardHat className="size-5 text-primary" aria-hidden="true" />
          شغل العمال على الأوردر
        </h2>
        <span className="whitespace-nowrap text-lg font-bold" data-testid="order-labor-total">
          {formatMoneyString(labor.total)}
        </span>
      </div>
      {labor.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">لسه مفيش شغل عمال متسجل على الأوردر ده.</p>
      ) : (
        <ul className="divide-y text-sm">
          {labor.entries.map((e) => (
            <li key={e.logId} className="flex items-start justify-between gap-3 py-2">
              <span>
                <Link href={`/workers/${e.workerId}`} className="font-semibold text-primary hover:underline">
                  {e.workerName}
                </Link>{" "}
                · {formatDateAr(e.date)} · {formatNumber(e.quantity)} {WORK_UNIT_LABELS[e.unit]} {WORK_TYPE_LABELS[e.workType]}
              </span>
              <span className="shrink-0 whitespace-nowrap font-semibold">{formatMoneyString(e.share)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        ده نصيب الأوردر من يوميات العمال حسب شغلهم فيه — محسوب من اليوميات نفسها ومش متسجل تاني كتكلفة.
      </p>
    </section>
  );
}
