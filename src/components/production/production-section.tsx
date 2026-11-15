import Link from "next/link";
import { Factory, PackageCheck, Truck } from "lucide-react";
import { voidDeliveryAction, voidReadyAction, voidStageAction } from "@/app/(app)/orders/production-actions";
import { VoidRecordForm } from "@/components/finance/void-record-form";
import { buttonVariants } from "@/components/ui/button";
import { formatDateAr } from "@/lib/dates";
import { formatNumber } from "@/lib/numbers";
import { OPERATION_LABELS, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import type { OrderProduction } from "@/server/services/production-service";

function ProgressBar({ ready, delivered, required }: { ready: number; delivered: number; required: number }) {
  const pct = (v: number) => (required > 0 ? `${Math.min(100, (v / required) * 100)}%` : "0%");
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`جاهز ${ready} ومسلم ${delivered} من ${required}`}>
      <div className="absolute inset-y-0 start-0 bg-primary/30" style={{ width: pct(ready) }} />
      <div className="absolute inset-y-0 start-0 bg-primary" style={{ width: pct(delivered) }} />
    </div>
  );
}

/** Production & delivery on the order page — physical pieces, no money. */
export function ProductionSection({
  orderId,
  production: p,
  canRecord,
  canDeliver,
  canCorrect,
  closed,
}: {
  orderId: string;
  production: OrderProduction;
  canRecord: boolean;
  canDeliver: boolean;
  canCorrect: boolean;
  closed: boolean;
}) {
  const u = UNIT_LABELS[p.unit];
  const t = p.totals;
  const stats = [
    { label: "المطلوب", value: t.required, tone: "bg-muted/60", id: "prod-required" },
    { label: "الجاهز", value: t.ready, tone: "bg-brand-soft", id: "prod-ready" },
    { label: "المسلم", value: t.delivered, tone: "bg-emerald-50", id: "prod-delivered" },
    { label: "جاهز ولم يسلم", value: t.readyNotDelivered, tone: "bg-amber-50", id: "prod-ready-not-delivered" },
    { label: "متبقي للإنتاج", value: t.remaining, tone: "bg-muted/60", id: "prod-remaining" },
  ];
  const incomplete = p.groups.flatMap((g) =>
    g.operations.filter((op) => (g.stage[op] ?? 0) < g.quantity).map((op) => ({ g, op, left: g.quantity - (g.stage[op] ?? 0) })),
  );

  return (
    <section id="production" className="scroll-mt-20 rounded-2xl border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-bold">
        <Factory className="size-5 text-primary" aria-hidden="true" />
        الإنتاج والتسليم
      </h2>
      <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
        {stats.map((s, i) => (
          <div key={s.id} className={cn("rounded-xl p-2.5", s.tone, i === 0 && "col-span-2 sm:col-span-1")}>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-0.5 whitespace-nowrap text-lg font-bold" data-testid={s.id}>
              {formatNumber(s.value)} <span className="text-xs font-normal">{u}</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        <ProgressBar ready={t.ready} delivered={t.delivered} required={t.required} />
      </div>

      {!closed && (canRecord || canDeliver) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {canRecord && (
            <Link href={`/orders/${orderId}/production/new`} className={buttonVariants({ size: "lg" })}>
              <PackageCheck className="size-5" aria-hidden="true" />
              تسجيل إنتاج
            </Link>
          )}
          {canDeliver && (
            <Link href={`/orders/${orderId}/deliveries/new`} className={buttonVariants({ size: "lg", variant: "outline" })}>
              <Truck className="size-5" aria-hidden="true" />
              تسليم قطع
            </Link>
          )}
        </div>
      )}

      {incomplete.length > 0 && t.remaining > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          لسه: {incomplete.map(({ g, op, left }) => `${OPERATION_LABELS[op]} ${formatNumber(left)}${p.groups.length > 1 ? ` (مجموعة ${g.position})` : ""}`).join(" · ")}
        </p>
      )}

      {p.groups.length > 1 && (
        <ul className="mt-3 space-y-2">
          {p.groups.map((g) => (
            <li key={g.id} className="rounded-xl border bg-background p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  مجموعة {g.position} — {formatNumber(g.quantity)} {u} — {g.description}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {g.operations.map((op) => `${OPERATION_LABELS[op]} ${formatNumber(g.stage[op] ?? 0)}`).join(" · ")}
                {g.operations.length > 0 && " · "}
                جاهز {formatNumber(g.ready)} · مسلم {formatNumber(g.delivered)}
              </p>
              <div className="mt-2">
                <ProgressBar ready={g.ready} delivered={g.delivered} required={g.quantity} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3">
        <summary className="inline-flex h-10 cursor-pointer list-none items-center rounded-lg px-1 text-sm font-medium text-primary">
          سجل الإنتاج ({p.stageHistory.length + p.readyHistory.length})
        </summary>
        <ul className="mt-1 divide-y rounded-xl border bg-background px-3 text-sm">
          {[...p.stageHistory.map((s) => ({ ...s, kind: "stage" as const })), ...p.readyHistory.map((r) => ({ ...r, kind: "ready" as const, operation: null, fromWorker: null }))]
            .sort((a, b) => (a.date === b.date ? b.createdAt.getTime() - a.createdAt.getTime() : a.date < b.date ? 1 : -1))
            .map((h) => (
              <li key={h.id} className={cn("py-2", h.voided && "opacity-60")}>
                <p className={cn(h.voided && "line-through")}>
                  <b>{formatNumber(h.quantity)} {u}</b> {h.kind === "ready" ? "جاهزة للتسليم ✓" : `خلصت ${OPERATION_LABELS[h.operation!]}`}
                  {p.groups.length > 1 && ` · مجموعة ${h.groupPosition}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateAr(h.date)} · سجّلها {h.recordedByName}
                  {h.fromWorker && ` · مع شغل ${h.fromWorker}`}
                  {h.notes && ` · ${h.notes}`}
                </p>
                {h.voided ? (
                  <p className="text-xs text-destructive">ملغي — {h.voided.byName}: {h.voided.reason}</p>
                ) : (
                  canCorrect && (
                    <VoidRecordForm
                      action={h.kind === "ready" ? voidReadyAction : voidStageAction}
                      id={h.id}
                      label="إلغاء السجل ده"
                      confirmLabel="تأكيد الإلغاء"
                      note="السجل هيفضل ظاهر بس مش هيتحسب."
                    />
                  )
                )}
              </li>
            ))}
          {p.stageHistory.length + p.readyHistory.length === 0 && <li className="py-3 text-muted-foreground">لسه مفيش إنتاج متسجل.</li>}
        </ul>
      </details>

      <details>
        <summary className="inline-flex h-10 cursor-pointer list-none items-center rounded-lg px-1 text-sm font-medium text-primary">
          سجل التسليم ({p.deliveryHistory.length})
        </summary>
        <ul className="mt-1 divide-y rounded-xl border bg-background px-3 text-sm">
          {p.deliveryHistory.map((d) => (
            <li key={d.id} className={cn("py-2", d.voided && "opacity-60")}>
              <p className={cn(d.voided && "line-through")}>
                <b>{formatNumber(d.quantity)} {u}</b> اتسلمت{p.groups.length > 1 && ` · مجموعة ${d.groupPosition}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateAr(d.date)} · سلّمها {d.recordedByName}
                {d.notes && ` · ${d.notes}`}
              </p>
              {d.voided ? (
                <p className="text-xs text-destructive">ملغي — {d.voided.byName}: {d.voided.reason}</p>
              ) : (
                canCorrect && <VoidRecordForm action={voidDeliveryAction} id={d.id} label="إلغاء التسليم ده" confirmLabel="تأكيد الإلغاء" note="التسليم هيفضل ظاهر بس مش هيتحسب." />
              )}
            </li>
          ))}
          {p.deliveryHistory.length === 0 && <li className="py-3 text-muted-foreground">لسه مفيش تسليم.</li>}
        </ul>
      </details>
    </section>
  );
}
