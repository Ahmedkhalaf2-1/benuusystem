"use client";

import { hueSubmit, STICKY_SUBMIT } from "@/components/ds/primitives";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { recordWorkLogAction } from "@/app/(app)/workers/actions";
import { ChoiceCards } from "@/components/finance/choice-cards";
import { Field, FormMessage, NativeSelect, Textarea } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import type { WorkType, WorkUnit } from "@/generated/prisma/enums";
import { newRequestId } from "@/lib/request-id";
import { OPERATION_LABELS, UNIT_LABELS } from "@/lib/orders/labels";
import { recordWorkLogSchema } from "@/lib/validations/workers";
import { WORK_TYPE_LABELS, WORK_TYPE_TO_OPERATION, WORK_TYPES, WORK_UNIT_LABELS, WORK_UNITS } from "@/lib/workers/labels";
import type { OpenOrderOption } from "@/server/services/order-service";
import { OrderPicker } from "./order-picker";

/** "تسجيل شغل" — for one worker; date defaults to today. */
export function WorkLogForm({
  workerId,
  today,
  defaultWorkType,
  defaultUnit,
}: {
  workerId: string;
  today: string;
  defaultWorkType: WorkType;
  defaultUnit: WorkUnit;
}) {
  const [requestId] = useState(newRequestId);
  const [workDate, setWorkDate] = useState(today);
  const [order, setOrder] = useState<OpenOrderOption | null | "none">(null);
  const [groupId, setGroupId] = useState<string>("");
  const [workType, setWorkType] = useState<WorkType>(defaultWorkType);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<WorkUnit>(defaultUnit);
  const [showHours, setShowHours] = useState(false);
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [stageQuantity, setStageQuantity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const groups = order && order !== "none" ? order.groups : [];
  const needsGroupChoice = groups.length > 1;
  // Optional: physical pieces that finished the matching step — only when it clearly applies.
  const stageOp = WORK_TYPE_TO_OPERATION[workType];
  const selectedGroup = groups.find((g) => g.id === groupId);
  const canConfirmStage = !!stageOp && !!selectedGroup && selectedGroup.operations.includes(stageOp);

  function chooseOrder(o: OpenOrderOption | null | "none") {
    setOrder(o);
    setErrors((e) => ({ ...e, orderId: "" }));
    setGroupId(o && o !== "none" && o.groups.length === 1 ? o.groups[0]!.id : "");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!order) {
      setErrors({ orderId: "اختار الأوردر (أو «شغل مش تبع أوردر معيّن»)" });
      return;
    }
    if (needsGroupChoice && !groupId) {
      setErrors({ orderGroupId: "اختار المجموعة اللي اشتغل فيها" });
      return;
    }
    const payload = {
      workerId,
      idempotencyKey: requestId,
      workDate,
      orderId: order !== "none" ? order.id : undefined,
      orderGroupId: order !== "none" && groupId ? groupId : undefined,
      workType,
      quantity,
      unit,
      hours: showHours ? hours : undefined,
      notes,
      stageQuantity: canConfirmStage && stageQuantity.trim() ? stageQuantity : undefined,
    };
    const check = recordWorkLogSchema.safeParse(payload);
    if (!check.success) {
      const fe: Record<string, string> = {};
      for (const i of check.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      const result = await recordWorkLogAction(payload);
      if (result && !result.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) if (v[0]) fe[k] = v[0];
        if (fe.hours) setShowHours(true);
        setErrors(fe);
        setMessage(result.message);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4 sm:p-5">
      <Field label="الأوردر" error={undefined}>
        <OrderPicker value={order} onChange={chooseOrder} error={errors.orderId} />
      </Field>
      {needsGroupChoice && (
        <ChoiceCards
          label="المجموعة"
          options={groups.map((g) => ({
            value: g.id,
            label: `مجموعة ${g.position}: ${g.quantity} ${order && order !== "none" ? UNIT_LABELS[order.unit] : ""} — ${g.description}`,
          }))}
          value={groupId}
          onChange={setGroupId}
          error={errors.orderGroupId}
        />
      )}
      <ChoiceCards
        label="نوع الشغل"
        options={WORK_TYPES.map((t) => ({ value: t, label: WORK_TYPE_LABELS[t] }))}
        value={workType}
        onChange={setWorkType}
      />
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="عمل كام النهارده؟" htmlFor="quantity" error={errors.quantity}>
          <Input
            id="quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="مثال: 200"
            className="h-14 text-xl font-bold"
            aria-invalid={errors.quantity ? true : undefined}
          />
        </Field>
        <Field label="الوحدة" htmlFor="unit">
          <NativeSelect id="unit" value={unit} onChange={(e) => setUnit(e.target.value as WorkUnit)} className="h-14 w-28">
            {WORK_UNITS.map((u) => (
              <option key={u} value={u}>
                {WORK_UNIT_LABELS[u]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {canConfirmStage && (
        <Field
          label={`كام قطعة خلصت مرحلة ${OPERATION_LABELS[stageOp!]} في الشغل ده؟`}
          htmlFor="stageQuantity"
          optional
          error={errors.stageQuantity}
          hint="قطع فعلية من الأوردر (مش عدد الطبعات). لو مش متأكد سيبها فاضية."
        >
          <Input id="stageQuantity" inputMode="numeric" value={stageQuantity} onChange={(e) => setStageQuantity(e.target.value)} placeholder="مثال: 50" aria-invalid={errors.stageQuantity ? true : undefined} />
        </Field>
      )}
      {showHours ? (
        <Field label="اشتغل فيه كام ساعة؟" htmlFor="hours" error={errors.hours} hint="بنحتاجها بس لو اشتغل في نفس اليوم بوحدات مختلفة (مثلًا متر وقطعة).">
          <Input id="hours" inputMode="decimal" dir="ltr" className="text-left" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="مثال: 3" />
        </Field>
      ) : (
        <button type="button" onClick={() => setShowHours(true)} className="-mt-2 text-sm text-muted-foreground underline-offset-4 hover:underline">
          اشتغل النهارده بوحدات مختلفة؟ اكتب الساعات
        </button>
      )}
      <Field label="اليوم" htmlFor="workDate" error={errors.workDate}>
        <Input id="workDate" type="date" value={workDate} max={today} onChange={(e) => setWorkDate(e.target.value)} />
      </Field>
      <Field label="ملاحظات" htmlFor="notes" optional>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
      </Field>
      <p className="text-xs text-muted-foreground">لو اليومية مش متسجلة لليوم ده، هتتسجل تلقائيًا إنه حضر.</p>
      <FormMessage message={message} />
      <div className={STICKY_SUBMIT}>
        <button type="submit" className={hueSubmit("blue")} disabled={pending}>
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        حفظ الشغل
      </button>
      </div>
    </form>
  );
}
