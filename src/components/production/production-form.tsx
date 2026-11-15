"use client";

import { useState, useTransition } from "react";
import { CalendarDays, ChevronDown, Factory, Gauge, Loader2 } from "lucide-react";
import { recordReadyAction, recordStageAction } from "@/app/(app)/orders/production-actions";
import { ChoiceCards } from "@/components/finance/choice-cards";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { FlowCard } from "@/components/ds/primitives";
import { Input } from "@/components/ui/input";
import type { PrintOperation, QuantityUnit } from "@/generated/prisma/enums";
import { formatNumber } from "@/lib/numbers";
import { OPERATION_LABELS, UNIT_LABELS } from "@/lib/orders/labels";
import { newRequestId } from "@/lib/request-id";
import type { GroupProgress } from "@/server/services/production-service";
import { SizeQuantities, sizeLines } from "./size-quantities";

const READY = "READY" as const;
type Step = PrintOperation | typeof READY;

/** "تسجيل إنتاج": which step finished how many pieces — or which pieces are ready. */
export function ProductionForm({ orderId, unit, groups, today }: { orderId: string; unit: QuantityUnit; groups: GroupProgress[]; today: string }) {
  const [requestId] = useState(newRequestId);
  const [groupId, setGroupId] = useState(groups.length === 1 ? groups[0]!.id : "");
  const group = groups.find((g) => g.id === groupId);
  const defaultStep = (g?: GroupProgress): Step | "" => (!g ? "" : g.operations.length === 0 ? READY : g.operations.length === 1 ? g.operations[0]! : "");
  const [step, setStep] = useState<Step | "">(defaultStep(group));
  const [alsoReady, setAlsoReady] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [sizeValues, setSizeValues] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const u = UNIT_LABELS[unit];

  const sized = (group?.sizes.length ?? 0) > 0;

  function chooseGroup(id: string) {
    setGroupId(id);
    setSizeValues({});
    setStep(defaultStep(groups.find((g) => g.id === id)));
    setErrors({});
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!group) return setErrors({ orderGroupId: "اختار المجموعة" });
    if (!step) return setErrors({ step: "اختار إيه اللي خلص" });
    setMessage(undefined);
    startTransition(async () => {
      const result =
        step === READY
          ? await recordReadyAction({
              orderId,
              orderGroupId: group.id,
              idempotencyKey: requestId,
              ...(sized ? { sizes: sizeLines(sizeValues) } : { quantity }),
              readyDate: date,
              notes,
              confirmAllOperations: confirmAll,
            })
          : await recordStageAction({
              orderId,
              orderGroupId: group.id,
              idempotencyKey: requestId,
              operation: step,
              ...(sized ? { sizes: sizeLines(sizeValues) } : { quantity }),
              workDate: date,
              notes,
              alsoReady: group.operations.length === 1 && alsoReady,
            });
      if (result && !result.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) if (v[0]) fe[k] = v[0];
        setErrors(fe);
        setMessage(result.fieldErrors ? undefined : result.message);
      }
    });
  }

  const multiStep = (group?.operations.length ?? 0) > 1;
  const leftForStep = !group || step === "" ? 0 : step === READY ? Math.max(0, group.maxReady - group.ready) : group.quantity - (group.stage[step] ?? 0);
  const bar = (label: string, done: number, total: number, tone: "blue" | "teal", note?: string) => (
    <div key={label}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular text-graphite">
          <b className="font-display text-ink">{formatNumber(done)}</b> / {formatNumber(total)} {u}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-track">
        <span className={tone === "blue" ? "block h-full rounded-full bg-brand-solid" : "block h-full rounded-full bg-brand-solid"} style={{ width: `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%` }} />
      </div>
      {note && <p className="mt-1 text-xs text-graphite">{note}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {groups.length > 1 && (
        <FlowCard>
          <ChoiceCards
            label="المجموعة"
            columns={2}
            options={groups.map((g) => ({ value: g.id, label: `مجموعة ${g.position}: ${formatNumber(g.quantity)} ${u} — ${g.description}` }))}
            value={groupId}
            onChange={chooseGroup}
            error={errors.orderGroupId}
          />
        </FlowCard>
      )}

      {group && (
        <>
          <FlowCard title="وصلنا لفين" icon={Gauge} hue="blue">
            <div className="space-y-3">
              {group.operations.map((op) => bar(OPERATION_LABELS[op], group.stage[op] ?? 0, group.quantity, "blue"))}
              {bar(
                "جاهز للتسليم",
                group.ready,
                group.quantity,
                "teal",
                multiStep && group.maxReady > group.ready ? `ممكن يوصل لـ ${formatNumber(group.maxReady)}` : undefined,
              )}
            </div>
          </FlowCard>

          <FlowCard>
            <div className="space-y-5">
              <ChoiceCards
                label="إيه اللي خلص؟"
                options={[
                  ...group.operations.map((op) => ({ value: op as Step, label: `مرحلة ${OPERATION_LABELS[op]}` })),
                  { value: READY as Step, label: "جاهز للتسليم" },
                ]}
                value={step}
                onChange={(s) => {
                  setStep(s);
                  setErrors({});
                }}
                error={errors.step ?? errors.operation}
              />

              {sized && step !== "" ? (
                <div>
                  <p className="mb-2 text-sm font-semibold">{step === READY ? "كام قطعة جاهزة من كل مقاس؟" : "عملنا كام من كل مقاس؟"}</p>
                  <SizeQuantities
                    rows={group.sizes.map((s) => ({
                      id: s.id,
                      label: s.label,
                      hint:
                        step === READY
                          ? `جاهز ${formatNumber(s.ready)} من ${formatNumber(s.quantity)} · ممكن لحد ${formatNumber(Math.max(0, s.maxReady - s.ready))}`
                          : `${OPERATION_LABELS[step]}: ${formatNumber(s.stage[step] ?? 0)} من ${formatNumber(s.quantity)}`,
                      max: step === READY ? Math.max(0, s.maxReady - s.ready) : s.quantity - (s.stage[step] ?? 0),
                    }))}
                    values={sizeValues}
                    onChange={(v) => {
                      setSizeValues(v);
                      setErrors({});
                    }}
                    errors={errors}
                    unitLabel={u}
                    quickFill={step === READY ? "كل الممكن يبقى جاهز" : "كل اللي فاضل"}
                  />
                  {errors.sizes && <p className="mt-1.5 text-sm text-red">{errors.sizes}</p>}
                </div>
              ) : (
                step !== "" && (
                  <Field label={step === READY ? "كام قطعة جاهزة؟" : "عملنا كام؟"} htmlFor="quantity" error={errors.quantity}>
                    <div className="relative">
                      <Input
                        id="quantity"
                        inputMode="numeric"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="0"
                        className="tabular h-16 rounded-2xl pe-16 text-center font-display text-[2rem] font-semibold placeholder:text-ink/20"
                        aria-invalid={errors.quantity ? true : undefined}
                        autoFocus
                      />
                      <span className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-sm text-graphite">{u}</span>
                    </div>
                    {leftForStep > 0 && (
                      <button
                        type="button"
                        onClick={() => setQuantity(String(leftForStep))}
                        className="mt-2 inline-flex h-9 items-center rounded-full bg-blue-soft px-3.5 text-sm font-semibold text-blue-ink transition-transform active:scale-95"
                      >
                        {step === READY ? "كل الممكن" : "كل اللي فاضل"} ({formatNumber(leftForStep)} {u})
                      </button>
                    )}
                  </Field>
                )
              )}

              {step !== READY && step !== "" && group.operations.length === 1 && (
                <label className="flex min-h-13 cursor-pointer items-center gap-3 rounded-2xl bg-teal-soft px-3.5 text-[0.95rem] font-semibold text-teal-ink">
                  <input type="checkbox" checked={alsoReady} onChange={(e) => setAlsoReady(e.target.checked)} className="size-5 accent-[var(--brand)]" />
                  القطع دي كمان جاهزة للتسليم
                </label>
              )}
              {step === READY && multiStep && (
                <div data-error={errors.confirmAllOperations ? "true" : undefined}>
                  <label className="flex min-h-13 cursor-pointer items-start gap-3 rounded-2xl bg-amber-soft px-3.5 py-3 text-[0.95rem] font-medium text-amber-ink">
                    <input type="checkbox" checked={confirmAll} onChange={(e) => setConfirmAll(e.target.checked)} className="mt-0.5 size-5 accent-[var(--warning)]" />
                    <span>متأكد إن نفس القطع دي خلصت كل الشغل: {group.description}</span>
                  </label>
                  {errors.confirmAllOperations && <p className="mt-1 text-sm text-red">{errors.confirmAllOperations}</p>}
                </div>
              )}
            </div>
          </FlowCard>

          <details className="group/more rounded-2xl bg-surface border border-line" open={!!(errors.workDate || errors.readyDate || date !== today)}>
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
              <CalendarDays className="size-5 text-graphite" aria-hidden="true" />
              <span className="font-semibold">التاريخ والملاحظات</span>
              <span className="ms-auto text-sm text-graphite">{date === today ? "النهارده" : date}</span>
              <ChevronDown className="size-4 text-graphite transition-transform group-open/more:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-4 px-4 pb-4">
              <Field label="التاريخ" htmlFor="date" error={errors.workDate ?? errors.readyDate}>
                <Input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="ملاحظات" htmlFor="notes" optional>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
              </Field>
            </div>
          </details>
        </>
      )}

      <FormMessage message={message} />
      <div className="sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4">
        <button
          type="submit"
          disabled={pending || !group}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-solid font-display text-lg font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Factory className="size-5" aria-hidden="true" />}
          <span>حفظ</span>
        </button>
      </div>
    </form>
  );
}
