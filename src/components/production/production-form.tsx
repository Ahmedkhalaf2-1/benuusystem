"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { recordReadyAction, recordStageAction } from "@/app/(app)/orders/production-actions";
import { ChoiceCards } from "@/components/finance/choice-cards";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PrintOperation, QuantityUnit } from "@/generated/prisma/enums";
import { formatNumber } from "@/lib/numbers";
import { OPERATION_LABELS, UNIT_LABELS } from "@/lib/orders/labels";
import { newRequestId } from "@/lib/request-id";
import type { GroupProgress } from "@/server/services/production-service";

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
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const u = UNIT_LABELS[unit];

  function chooseGroup(id: string) {
    setGroupId(id);
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
          ? await recordReadyAction({ orderId, orderGroupId: group.id, idempotencyKey: requestId, quantity, readyDate: date, notes, confirmAllOperations: confirmAll })
          : await recordStageAction({
              orderId,
              orderGroupId: group.id,
              idempotencyKey: requestId,
              operation: step,
              quantity,
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
  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
      {groups.length > 1 && (
        <ChoiceCards
          label="المجموعة"
          options={groups.map((g) => ({ value: g.id, label: `مجموعة ${g.position}: ${formatNumber(g.quantity)} ${u} — ${g.description}` }))}
          value={groupId}
          onChange={chooseGroup}
          error={errors.orderGroupId}
        />
      )}

      {group && (
        <>
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            {group.operations.map((op) => (
              <p key={op}>
                {OPERATION_LABELS[op]}: <b>{formatNumber(group.stage[op] ?? 0)}</b> من {formatNumber(group.quantity)} {u}
              </p>
            ))}
            <p>
              جاهز للتسليم: <b>{formatNumber(group.ready)}</b> من {formatNumber(group.quantity)} {u}
              {multiStep && group.maxReady > group.ready && <span className="text-muted-foreground"> (ممكن يوصل لـ {formatNumber(group.maxReady)})</span>}
            </p>
          </div>

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

          <Field label={step === READY ? "كام قطعة جاهزة؟" : "عملنا كام؟"} htmlFor="quantity" error={errors.quantity}>
            <div className="relative">
              <Input
                id="quantity"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className="h-14 pe-16 text-xl font-bold"
                aria-invalid={errors.quantity ? true : undefined}
                autoFocus
              />
              <span className="pointer-events-none absolute inset-y-0 end-3.5 flex items-center text-sm text-muted-foreground">{u}</span>
            </div>
          </Field>

          {step !== READY && step !== "" && group.operations.length === 1 && (
            <label className="flex min-h-12 items-center gap-3 rounded-xl border bg-surface px-3 text-[0.95rem] font-medium">
              <input type="checkbox" checked={alsoReady} onChange={(e) => setAlsoReady(e.target.checked)} className="size-5 accent-[var(--primary)]" />
              القطع دي كمان جاهزة للتسليم
            </label>
          )}
          {step === READY && multiStep && (
            <div data-error={errors.confirmAllOperations ? "true" : undefined}>
              <label className="flex min-h-12 items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-[0.95rem] font-medium">
                <input type="checkbox" checked={confirmAll} onChange={(e) => setConfirmAll(e.target.checked)} className="mt-0.5 size-5 accent-[var(--primary)]" />
                <span>متأكد إن نفس القطع دي خلصت كل الشغل: {group.description}</span>
              </label>
              {errors.confirmAllOperations && <p className="mt-1 text-sm text-destructive">{errors.confirmAllOperations}</p>}
            </div>
          )}

          <Field label="التاريخ" htmlFor="date" error={errors.workDate ?? errors.readyDate}>
            <Input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="ملاحظات" htmlFor="notes" optional>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
          </Field>
        </>
      )}

      <FormMessage message={message} />
      <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={pending || !group}>
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        حفظ
      </Button>
    </form>
  );
}
