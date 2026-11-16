import type { ReactNode } from "react";
import { ChevronDown, CircleCheck, Factory, Layers, PackageCheck, Ruler, Truck, type LucideIcon } from "lucide-react";
import { voidDeliveryAction, voidReadyAction, voidStageAction } from "@/app/(app)/orders/production-actions";
import { VoidRecordForm } from "@/components/finance/void-record-form";
import { GaugeSwatch, ProductionTrack } from "@/components/ds/production-track";
import { formatDateAr } from "@/lib/dates";
import { formatNumber } from "@/lib/numbers";
import { OPERATION_LABELS, placementsText, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import type { GroupProgress, OrderProduction } from "@/server/services/production-service";

/** A card that opens and closes — secondary information, one tap away. */
export function Fold({
  title,
  icon: Icon,
  hue = "bg-violet-soft text-violet",
  meta,
  open,
  id,
  children,
}: {
  title: string;
  icon: LucideIcon;
  hue?: string;
  meta?: ReactNode;
  open?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <details id={id} open={open} className="group/fold scroll-mt-20 rounded-2xl bg-surface border border-line">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-well/60 [&::-webkit-details-marker]:hidden">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", hue)}>
          <Icon className="size-[1.1rem]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 font-display text-[1.02rem] leading-snug font-semibold">{title}</span>
        {meta && <span className="max-w-[45%] shrink-0 text-end text-sm leading-snug text-graphite">{meta}</span>}
        <ChevronDown
          className="size-4 shrink-0 text-graphite transition-transform duration-300 ease-[var(--ease-out-expo)] group-open/fold:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

/** The headline of the job on the violet stage: delivered of ordered, the bar, and three readings. */
export function ProductionReadout({ production: p }: { production: OrderProduction }) {
  const u = UNIT_LABELS[p.unit];
  const t = p.totals;
  const pct = t.required > 0 ? Math.round((t.delivered / t.required) * 100) : 0;
  const readings = [
    { label: "اتعمل", value: t.ready, id: "prod-ready", kind: null },
    { label: "جاهز للتسليم", value: t.readyNotDelivered, id: "prod-ready-not-delivered", kind: "ready" as const },
    { label: "باقي للإنتاج", value: t.remaining, id: "prod-remaining", kind: "left" as const },
  ];
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="leading-none">
          <span className="tabular font-display text-[2.75rem] font-semibold tracking-[-0.03em]" data-testid="prod-delivered">
            {formatNumber(t.delivered)}
          </span>
          <span className="ms-1.5 text-[1.05rem] text-on-panel-muted">
            من{" "}
            <b className="tabular font-semibold text-white" data-testid="prod-required">
              {formatNumber(t.required)}
            </b>{" "}
            {u} اتسلمت
          </span>
        </p>
        <span className="tabular rounded-full bg-panel-2 px-2.5 py-1 font-display text-sm font-semibold ring-1 ring-panel-line">{pct}%</span>
      </div>
      <ProductionTrack className="mt-3" size="lg" tone="dark" required={t.required} ready={t.ready} delivered={t.delivered} unitLabel={u} />
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {readings.map((r) => (
          <div key={r.id} className="rounded-2xl bg-panel-2 px-3 py-2.5 ring-1 ring-panel-line">
            <dt className="flex items-center gap-1.5 text-[0.72rem] whitespace-nowrap text-on-panel-muted">
              {r.kind ? <GaugeSwatch kind={r.kind} dark /> : <CircleCheck className="size-3 text-on-panel-muted" aria-hidden="true" />}
              {r.label}
            </dt>
            <dd className="tabular mt-1 font-display text-[1.35rem] leading-none font-semibold" data-testid={r.id}>
              {formatNumber(r.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StepBar({ label, done, total, tone }: { label: string; done: number; total: number; tone: "blue" | "teal" }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular text-graphite">
          <b className="font-display text-ink">{formatNumber(done)}</b> / {formatNumber(total)}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-track">
        <span className={cn("block h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]", tone === "blue" ? "bg-brand-solid" : "bg-brand-solid")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** How far each required step has come, then how many pieces finished all of them. */
export function StagesCard({ production: p }: { production: OrderProduction }) {
  const multi = p.groups.length > 1;
  if (!p.groups.some((g) => g.operations.length > 0 || g.designs.length > 0)) return null;
  return (
    <section aria-labelledby="stages-heading" className="rounded-2xl bg-surface p-4 border border-line">
      <h2 id="stages-heading" className="mb-3 flex items-center gap-2.5 font-display text-[1.02rem] font-semibold">
        <span className="flex size-9 items-center justify-center rounded-xl bg-blue-soft text-blue-ink">
          <Factory className="size-[1.1rem]" aria-hidden="true" />
        </span>
        مراحل الشغل
      </h2>
      <div className="space-y-4">
        {p.groups.map((g) => (
          <div key={g.id} className={cn(multi && "rounded-2xl bg-well p-3")}>
            {(multi || g.designs.length > 0) && (
              <p className="mb-2.5 text-sm font-semibold">
                <span className="text-brand">{g.label}</span> · {formatNumber(g.quantity)} قطعة
              </p>
            )}
            <div className="space-y-3">
              {/* Items with designs: each design on its own (they're on the same pieces). */}
              {g.designs.length > 0
                ? g.designs.map((d) => (
                    <StepBar
                      key={d.id}
                      label={`${d.label} — ${OPERATION_LABELS[d.operation]}${placementsText(d.placements, d.customPlacements) ? ` (${placementsText(d.placements, d.customPlacements)})` : ""}`}
                      done={g.design[d.id] ?? 0}
                      total={d.quantity}
                      tone="blue"
                    />
                  ))
                : g.operations.map((op) => <StepBar key={op} label={OPERATION_LABELS[op]} done={g.stage[op] ?? 0} total={g.quantity} tone="blue" />)}
              <StepBar label="جاهز للتسليم (خلص كل الشغل)" done={g.ready} total={g.quantity} tone="teal" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SizeTiles({ group, unit }: { group: GroupProgress; unit: string }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {group.sizes.map((s) => {
        const done = s.delivered >= s.quantity;
        return (
          <li key={s.id} className={cn("rounded-2xl p-3", done ? "bg-violet-soft" : "bg-well")}>
            <div className="flex items-baseline justify-between">
              <span dir="ltr" className="font-display text-xl font-semibold">
                {s.label}
              </span>
              <span className="tabular text-xs text-graphite">
                {formatNumber(s.quantity)} {unit}
              </span>
            </div>
            <ProductionTrack className="mt-2" size="sm" required={s.quantity} ready={s.ready} delivered={s.delivered} unitLabel={unit} />
            <p className="mt-2 text-xs text-graphite">
              جاهز <b className="tabular text-teal-ink">{formatNumber(s.ready)}</b> · اتسلم <b className="tabular text-violet">{formatNumber(s.delivered)}</b>
            </p>
            {group.designs.length > 0 ? (
              <p className="mt-0.5 truncate text-[0.7rem] text-graphite">
                {group.designs.map((d) => `${d.label} ${formatNumber(s.design[d.id] ?? 0)}`).join(" · ")}
              </p>
            ) : (
              group.operations.length > 1 && (
                <p className="mt-0.5 truncate text-[0.7rem] text-graphite">
                  {group.operations.map((op) => `${OPERATION_LABELS[op]} ${formatNumber(s.stage[op] ?? 0)}`).join(" · ")}
                </p>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Groups and sizes as tiles, then the timeline of everything recorded. */
export function ProductionBreakdown({ production: p, canCorrect }: { production: OrderProduction; canCorrect: boolean }) {
  const u = UNIT_LABELS[p.unit];
  const multi = p.groups.length > 1;
  const sized = p.groups.some((g) => g.sizes.length > 0);
  const history = [
    ...p.stageHistory.map((s) => ({ ...s, kind: "stage" as const })),
    ...p.readyHistory.map((r) => ({ ...r, kind: "ready" as const, operation: null, fromWorker: null, designLabel: null })),
    ...p.deliveryHistory.map((d) => ({ ...d, kind: "delivery" as const, operation: null, fromWorker: null, designLabel: null })),
  ].sort((a, b) => (a.date === b.date ? b.createdAt.getTime() - a.createdAt.getTime() : a.date < b.date ? 1 : -1));
  const where = (h: { groupLabel: string; sizeLabel: string | null; designLabel?: string | null }) =>
    [multi && h.groupLabel, h.designLabel, h.sizeLabel && `مقاس ${h.sizeLabel}`].filter(Boolean).join("، ");
  const KIND = {
    stage: { icon: Factory, tone: "bg-blue-soft text-blue-ink" },
    ready: { icon: PackageCheck, tone: "bg-teal-soft text-teal-ink" },
    delivery: { icon: Truck, tone: "bg-violet-soft text-violet" },
  } as const;

  return (
    <>
      {(multi || sized) && (
        <Fold
          id="production"
          title={sized ? "المقاسات والكميات" : "المجموعات"}
          icon={sized ? Ruler : Layers}
          hue="bg-brand-soft text-brand-ink"
          meta={multi ? `${formatNumber(p.groups.length)} بنود` : undefined}
          open
        >
          <div className="space-y-4">
            {p.groups.map((g) => (
              <div key={g.id}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold">
                    {multi && <span className="text-brand">{g.label}: </span>}
                    {g.designs.length > 0 ? g.designs.map((d) => d.label).join(" + ") : g.description}
                  </p>
                  <span className="tabular shrink-0 text-xs text-graphite">
                    {formatNumber(g.quantity)} {u}
                  </span>
                </div>
                {g.sizes.length > 0 ? (
                  <SizeTiles group={g} unit={u} />
                ) : (
                  <div className="rounded-2xl bg-well p-3">
                    <ProductionTrack size="sm" required={g.quantity} ready={g.ready} delivered={g.delivered} unitLabel={u} />
                    <p className="mt-2 text-xs text-graphite">
                      جاهز <b className="tabular text-teal-ink">{formatNumber(g.ready)}</b> · اتسلم <b className="tabular text-violet">{formatNumber(g.delivered)}</b>
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Fold>
      )}

      <Fold title="سجل الإنتاج والتسليم" icon={Layers} meta={`${formatNumber(history.length)} سجل`}>
        {history.length === 0 ? (
          <p className="text-sm text-graphite">لسه مفيش حاجة متسجلة.</p>
        ) : (
          <ol className="relative space-y-3 before:absolute before:inset-y-2 before:start-[1.05rem] before:w-px before:bg-hairline">
            {history.map((h) => {
              const k = KIND[h.kind];
              return (
                <li key={`${h.kind}-${h.id}`} className={cn("relative flex gap-3", h.voided && "opacity-55")}>
                  <span className={cn("relative z-10 flex size-[2.1rem] shrink-0 items-center justify-center rounded-full ring-4 ring-surface", k.tone)}>
                    <k.icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5 text-sm">
                    <p className={cn(h.voided && "line-through")}>
                      <b className="tabular font-display">
                        {formatNumber(h.quantity)} {u}
                      </b>{" "}
                      {h.kind === "ready" ? "جاهزة للتسليم ✓" : h.kind === "delivery" ? "اتسلمت" : `خلصت ${OPERATION_LABELS[h.operation!]}`}
                      {where(h) && <span className="text-graphite"> — {where(h)}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-graphite">
                      {formatDateAr(h.date)}، {h.kind === "delivery" ? "سلّمها" : "سجّلها"} {h.recordedByName}
                      {h.fromWorker && `، مع شغل ${h.fromWorker}`}
                      {h.notes && `. ${h.notes}`}
                    </p>
                    {h.voided ? (
                      <p className="text-xs text-red">
                        ملغي — {h.voided.byName}: {h.voided.reason}
                      </p>
                    ) : (
                      canCorrect && (
                        <VoidRecordForm
                          action={h.kind === "ready" ? voidReadyAction : h.kind === "delivery" ? voidDeliveryAction : voidStageAction}
                          id={h.id}
                          label={h.kind === "delivery" ? "إلغاء التسليم ده" : "إلغاء السجل ده"}
                          confirmLabel="تأكيد الإلغاء"
                          note={h.kind === "delivery" ? "التسليم هيفضل ظاهر بس مش هيتحسب." : "السجل هيفضل ظاهر بس مش هيتحسب."}
                        />
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Fold>
    </>
  );
}

/** Steps that still have pieces to do, in one line. */
export function stepsLeft(p: OrderProduction): string | null {
  const multi = p.groups.length > 1;
  const left = p.groups.flatMap((g) =>
    g.designs.length > 0
      ? g.designs
          .filter((d) => (g.design[d.id] ?? 0) < d.quantity)
          .map((d) => `${d.label} ${formatNumber(d.quantity - (g.design[d.id] ?? 0))}${multi ? ` (${g.label})` : ""}`)
      : g.operations
          .filter((op) => (g.stage[op] ?? 0) < g.quantity)
          .map((op) => `${OPERATION_LABELS[op]} ${formatNumber(g.quantity - (g.stage[op] ?? 0))}${multi ? ` (${g.label})` : ""}`),
  );
  return left.length > 0 && p.totals.remaining > 0 ? left.join("، ") : null;
}
