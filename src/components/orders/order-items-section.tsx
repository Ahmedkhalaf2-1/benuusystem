import { Layers } from "lucide-react";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { OPERATION_LABELS, placementsText } from "@/lib/orders/labels";
import type { OrderDetails } from "@/server/services/order-service";

/**
 * The order's items («البنود») with their designs. Physical quantity is the
 * item's; a design's pieces are work on those same pieces. Planned presses are
 * a plan; recorded presses come only from worker output in presses.
 */
export function OrderItemsList({ order, unitLabel }: { order: OrderDetails; unitLabel: string }) {
  const priced = order.pricing === "PER_ITEM";
  return (
    <div className="space-y-3">
      {order.groups.map((g) => (
        <article key={g.id} className="rounded-2xl bg-well p-3.5" data-testid="order-item">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display font-semibold break-words">{g.label}</h3>
              <p className="text-sm text-graphite">
                <span className="tabular">{formatNumber(g.quantity)}</span> {unitLabel} · {g.material}
              </p>
            </div>
            {priced && g.unitPrice !== null && g.lineTotal !== null && (
              <div className="shrink-0 text-end">
                <p className="tabular font-display font-semibold">{formatMoneyString(g.lineTotal)}</p>
                <p className="tabular text-xs text-graphite">
                  {formatNumber(g.quantity)} × {formatMoneyString(g.unitPrice)}
                </p>
              </div>
            )}
          </div>

          {g.designs.length > 0 ? (
            <ul className="mt-2.5 space-y-1.5">
              {g.designs.map((d) => (
                <li key={d.id} className="rounded-xl bg-surface px-3 py-2 text-sm">
                  <p className="font-semibold">
                    {d.label} <span className="font-normal text-graphite">— {OPERATION_LABELS[d.operation]}</span>
                  </p>
                  <p className="text-xs text-graphite">
                    {placementsText(d.placements, d.customPlacements) || "من غير مكان محدد"}
                    {" · "}
                    <span className="tabular">{formatNumber(d.quantity)}</span> {d.quantity < g.quantity ? `من ${formatNumber(g.quantity)}` : unitLabel}
                    {d.plannedPresses !== null && (
                      <>
                        {" · "}مخطط <span className="tabular">{formatNumber(d.plannedPresses)}</span> كبسة
                      </>
                    )}
                  </p>
                  {d.notes && <p className="mt-0.5 text-xs">{d.notes}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm">{g.description}</p>
          )}

          {g.sizes.length > 0 && (
            <p className="tabular mt-2 text-xs text-graphite">{g.sizes.map((s) => `${s.label}: ${formatNumber(s.quantity)}`).join("  ·  ")}</p>
          )}
          {(g.plannedPresses !== null || g.recordedPresses > 0) && (
            <p className="mt-2 text-xs text-graphite" data-testid="item-presses">
              الكبسات: مخطط <b className="tabular text-ink">{g.plannedPresses !== null ? formatNumber(g.plannedPresses) : "—"}</b>
              {" · "}متسجل من شغل العمال <b className="tabular text-ink">{formatNumber(g.recordedPresses)}</b>
            </p>
          )}
          {g.notes && <p className="mt-1.5 text-sm">{g.notes}</p>}
        </article>
      ))}
      {priced && (
        <p className="flex items-baseline justify-between px-1 text-sm">
          <span className="text-graphite">مجموع البنود = إجمالي الأوردر</span>
          <span className="tabular font-display font-semibold">{formatMoneyString(order.totalPrice)}</span>
        </p>
      )}
      {!priced && <p className="px-1 text-xs text-graphite">أوردر متسعّر بسعر إجمالي واحد ({formatMoneyString(order.totalPrice)})، من غير سعر لكل بند.</p>}
      {order.plannedPresses !== null && (
        <p className="px-1 text-xs text-graphite">
          إجمالي الكبسات المخططة للأوردر <b className="tabular text-ink">{formatNumber(order.plannedPresses)}</b> — تخطيط بس؛ المتسجل فعلًا{" "}
          <b className="tabular text-ink">{formatNumber(order.recordedPresses)}</b>.
        </p>
      )}
    </div>
  );
}

export const ITEMS_ICON = Layers;
