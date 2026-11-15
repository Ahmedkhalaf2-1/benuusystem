"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { recordDeliveryAction } from "@/app/(app)/orders/production-actions";
import { ChoiceCards } from "@/components/finance/choice-cards";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { QuantityUnit } from "@/generated/prisma/enums";
import { formatNumber } from "@/lib/numbers";
import { UNIT_LABELS } from "@/lib/orders/labels";
import { newRequestId } from "@/lib/request-id";
import type { GroupProgress } from "@/server/services/production-service";

/** "تسليم قطع": only what is ready and not yet delivered. */
export function DeliveryForm({ orderId, unit, groups, today }: { orderId: string; unit: QuantityUnit; groups: GroupProgress[]; today: string }) {
  const [requestId] = useState(newRequestId);
  const available = (g: GroupProgress) => g.ready - g.delivered;
  const withStock = groups.filter((g) => available(g) > 0);
  const [groupId, setGroupId] = useState(withStock.length === 1 ? withStock[0]!.id : "");
  const group = groups.find((g) => g.id === groupId);
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const u = UNIT_LABELS[unit];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!group) return setErrors({ orderGroupId: "اختار المجموعة" });
    setMessage(undefined);
    startTransition(async () => {
      const result = await recordDeliveryAction({ orderId, orderGroupId: group.id, idempotencyKey: requestId, quantity, deliveredAt: date, notes });
      if (result && !result.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) if (v[0]) fe[k] = v[0];
        setErrors(fe);
        setMessage(result.fieldErrors ? undefined : result.message);
      }
    });
  }

  if (withStock.length === 0) {
    return <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">مفيش قطع جاهزة لسه متسلمتش. سجّل الجاهز الأول من «تسجيل إنتاج».</p>;
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
      {withStock.length > 1 && (
        <ChoiceCards
          label="المجموعة"
          options={withStock.map((g) => ({ value: g.id, label: `مجموعة ${g.position}: ${g.description} — جاهز ${formatNumber(available(g))} ${u}` }))}
          value={groupId}
          onChange={(id) => {
            setGroupId(id);
            setErrors({});
          }}
          error={errors.orderGroupId}
        />
      )}
      {group && (
        <>
          <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
            جاهز ولم يسلم: <b>{formatNumber(available(group))}</b> {u}
          </div>
          <Field label="سلمنا كام؟" htmlFor="quantity" error={errors.quantity}>
            <div className="relative">
              <Input id="quantity" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" className="h-14 pe-16 text-xl font-bold" aria-invalid={errors.quantity ? true : undefined} autoFocus />
              <span className="pointer-events-none absolute inset-y-0 end-3.5 flex items-center text-sm text-muted-foreground">{u}</span>
            </div>
          </Field>
          <button type="button" onClick={() => setQuantity(String(available(group)))} className="-mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
            سلّمنا كل الجاهز ({formatNumber(available(group))} {u})
          </button>
          <Field label="تاريخ التسليم" htmlFor="date" error={errors.deliveredAt}>
            <Input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="ملاحظات" htmlFor="notes" optional>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" placeholder="مثال: استلمها أحمد من العميل" />
          </Field>
        </>
      )}
      <FormMessage message={message} />
      <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={pending || !group}>
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        حفظ التسليم
      </Button>
    </form>
  );
}
