import type { ReactNode } from "react";
import { ChevronDown, CircleCheck, Factory, Layers, PackageCheck, Ruler, Truck, type LucideIcon } from "lucide-react";
import { voidDeliveryAction, voidReadyAction, voidStageAction } from "@/app/(app)/orders/production-actions";
import { VoidRecordForm } from "@/components/finance/void-record-form";
import { GaugeSwatch, ProductionTrack } from "@/components/ds/production-track";
import { formatDateAr } from "@/lib/dates";
import { formatNumber } from "@/lib/numbers";
import { OPERATION_LABELS, UNIT_LABELS } from "@/lib/orders/labels";
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
    <details id={id} open={open} className="group/fold scroll-mt-20 rounded-[1.5rem] bg-surface shadow-[var(--shadow-card)]">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-[1.5rem] px-4 py-3 transition-colors hover:bg-well/60 [&::-webkit-details-marker]:hidden">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", hue)}>
          <Icon className="size-[1.1rem]" aria-hidden="true" />
        </span>
        <span className="font-display text-[1.02rem] font-semibold">{title}</span>
        <span className="ms-auto truncate text-sm text-graphite">{meta}</span>
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
          <span className="ms-1.5 text-[1.05rem] text-white/75">
            من{" "}
            <b className="tabular font-semibold text-white" data-testid="prod-required">
              {formatNumber(t.required)}
            </b>{" "}
            {u} اتسلمت
          </span>
        </p>
        <span className="tabular rounded-full bg-white/12 px-2.5 py-1 font-display text-sm font-semibold ring-1 ring-white/15">{pct}%</span>
      </div>
      <ProductionTrack className="mt-3" size="lg" tone="dark" required={t.required} ready={t.ready} delivered={t.delivered} unitLabel={u} />
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {readings.map((r) => (
          <div key={r.id} className="rounded-2xl bg-white/10 px-3 py-2.5 ring-1 ring-white/12">
            <dt className="flex items-center gap-1.5 text-[0.72rem] whitespace-nowrap text-white/75">
              {r.kind ? <GaugeSwatch kind={r.kind} dark /> : <CircleCheck className="size-3 text-white/80" aria-hidden="true" />}
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
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#ebe7f4]">
        <span className={cn("block h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]", tone === "blue" ? "bg-blue" : "bg-teal")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** How far each required step has come, then how many pieces finished all of them. */
export function StagesCard({ production: p }: { production: OrderProduction }) {
  const multi = p.groups.length > 1;
  if (!p.groups.some((g) => g.operations.length > 0)) return null;
  return (
    <section aria-labelledby="stages-heading" className="rounded-[1.5rem] bg-surface p-4 shadow-[var(--shadow-card)]">
      <h2 id="stages-heading" className="mb-3 flex items-center gap-2.5 font-display text-[1.02rem] font-semibold">
        <span className="flex size-9 items-center justify-center rounded-xl bg-blue-soft text-blue-ink">
          <Factory className="size-[1.1rem]" aria-hidden="true" />
        </span>
        مراحل الشغل
      </h2>
      <div className="space-y-4">
        {p.groups.map((g) => (
          <div key={g.id} className={cn(multi && "rounded-2xl bg-well p-3")}>
            {multi && (
              <p className="mb-2.5 text-sm font-semibold">
                <span className="text-violet">مجموعة {formatNumber(g.position)}</span> · {g.description}
              </p>
            )}
            <div className="space-y-3">
              {g.operations.map((op) => (
                <StepBar key={op} label={OPERATION_LABELS[op]} done={g.stage[op] ?? 0} total={g.quantity} tone="blue" />
              ))}
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
            {group.operations.length > 1 && (
              <p className="mt-0.5 truncate text-[0.7rem] text-graphite">
                {group.operations.map((op) => `${OPERATION_LABELS[op]} ${formatNumber(s.stage[op] ?? 0)}`).join(" · ")}
              </p>
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
    ...p.readyHistory.map((r) => ({ ...r, kind: "ready" as const, operation: null, fromWorker: null })),
    ...p.deliveryHistory.map((d) => ({ ...d, kind: "delivery" as const, operation: null, fromWorker: null })),
  ].sort((a, b) => (a.date === b.date ? b.createdAt.getTime() - a.createdAt.getTime() : a.date < b.date ? 1 : -1));
  const where = (h: { groupPosition: number; sizeLabel: string | null }) =>
    [multi && `مجموعة ${h.groupPosition}`, h.sizeLabel && `مقاس ${h.sizeLabel}`].filter(Boolean).join("، ");
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
          hue="bg-teal-soft text-teal-ink"
          meta={multi ? `${formatNumber(p.groups.length)} مجموعات` : undefined}
          open
        >
          <div className="space-y-4">
            {p.groups.map((g) => (
              <div key={g.id}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold">
                    {multi && <span className="text-violet">مجموعة {formatNumber(g.position)}: </span>}
                    {g.description}
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
    g.operations
      .filter((op) => (g.stage[op] ?? 0) < g.quantity)
      .map((op) => `${OPERATION_LABELS[op]} ${formatNumber(g.quantity - (g.stage[op] ?? 0))}${multi ? ` (مجموعة ${g.position})` : ""}`),
  );
  return left.length > 0 && p.totals.remaining > 0 ? left.join("، ") : null;
}
