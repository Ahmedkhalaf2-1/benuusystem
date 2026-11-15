"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown, Factory, Loader2, PackageCheck, Truck } from "lucide-react";
import { recordDeliveryAction } from "@/app/(app)/orders/production-actions";
import { ChoiceCards } from "@/components/finance/choice-cards";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { EmptyState, FlowCard } from "@/components/ds/primitives";
import { Input } from "@/components/ui/input";
import type { QuantityUnit } from "@/generated/prisma/enums";
import { formatNumber } from "@/lib/numbers";
import { UNIT_LABELS } from "@/lib/orders/labels";
import { newRequestId } from "@/lib/request-id";
import type { GroupProgress } from "@/server/services/production-service";
import { SizeQuantities, sizeLines } from "./size-quantities";

/** "تسليم قطع": only what is ready and not yet delivered. */
export function DeliveryForm({ orderId, unit, groups, today }: { orderId: string; unit: QuantityUnit; groups: GroupProgress[]; today: string }) {
  const [requestId] = useState(newRequestId);
  const available = (g: GroupProgress) => g.ready - g.delivered;
  const withStock = groups.filter((g) => available(g) > 0);
  const [groupId, setGroupId] = useState(withStock.length === 1 ? withStock[0]!.id : "");
  const group = groups.find((g) => g.id === groupId);
  const [quantity, setQuantity] = useState("");
  const [sizeValues, setSizeValues] = useState<Record<string, string>>({});
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
      const sized = group.sizes.length > 0;
      const result = await recordDeliveryAction({
        orderId,
        orderGroupId: group.id,
        idempotencyKey: requestId,
        ...(sized ? { sizes: sizeLines(sizeValues) } : { quantity }),
        deliveredAt: date,
        notes,
      });
      if (result && !result.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) if (v[0]) fe[k] = v[0];
        setErrors(fe);
        setMessage(result.fieldErrors ? undefined : result.message);
      }
    });
  }

  if (withStock.length === 0) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="مفيش قطع جاهزة للتسليم"
        action={
          <Link
            href={`/orders/${orderId}/production/new`}
            className="inline-flex h-12 items-center gap-2 rounded-2xl bg-brand-solid px-5 font-display font-semibold text-white transition-transform active:scale-[0.97]"
          >
            <Factory className="size-5" aria-hidden="true" />
            تسجيل إنتاج
          </Link>
        }
      >
        سجّل القطع الجاهزة الأول، وبعدها تقدر تسلّمها من هنا.
      </EmptyState>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {withStock.length > 1 && (
        <FlowCard>
          <ChoiceCards
            label="المجموعة"
            options={withStock.map((g) => ({ value: g.id, label: `مجموعة ${g.position}: ${g.description} — جاهز ${formatNumber(available(g))} ${u}` }))}
            value={groupId}
            onChange={(id) => {
              setGroupId(id);
              setSizeValues({});
              setErrors({});
            }}
            error={errors.orderGroupId}
          />
        </FlowCard>
      )}
      {group && (
        <>
          <section className="flex items-center gap-4 rounded-2xl bg-brand-solid px-5 py-4 text-white">
            <PackageCheck className="size-8 shrink-0 opacity-90" aria-hidden="true" />
            <div>
              <p className="text-sm text-on-panel-muted">جاهز ولم يسلم</p>
              <p className="tabular font-display text-[2rem] leading-none font-semibold">
                {formatNumber(available(group))} <span className="text-base font-medium">{u}</span>
              </p>
            </div>
          </section>

          <FlowCard>
            {group.sizes.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-semibold">سلمنا كام من كل مقاس؟</p>
                <SizeQuantities
                  rows={group.sizes
                    .filter((sz) => sz.ready - sz.delivered > 0)
                    .map((sz) => ({ id: sz.id, label: sz.label, hint: `جاهز ولم يسلم ${formatNumber(sz.ready - sz.delivered)}`, max: sz.ready - sz.delivered }))}
                  values={sizeValues}
                  onChange={(v) => {
                    setSizeValues(v);
                    setErrors({});
                  }}
                  errors={errors}
                  unitLabel={u}
                  quickFill="سلّمنا كل الجاهز"
                />
                {errors.sizes && <p className="mt-1.5 text-sm text-red">{errors.sizes}</p>}
              </div>
            ) : (
              <Field label="سلمنا كام؟" htmlFor="quantity" error={errors.quantity}>
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
                <button
                  type="button"
                  onClick={() => setQuantity(String(available(group)))}
                  className="mt-2 inline-flex h-9 items-center rounded-full bg-teal-soft px-3.5 text-sm font-semibold text-teal-ink transition-transform active:scale-95"
                >
                  سلّمنا كل الجاهز ({formatNumber(available(group))} {u})
                </button>
              </Field>
            )}
          </FlowCard>

          <details className="group/more rounded-2xl bg-surface border border-line" open={!!(errors.deliveredAt || date !== today)}>
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
              <CalendarDays className="size-5 text-graphite" aria-hidden="true" />
              <span className="font-semibold">التاريخ والملاحظات</span>
              <span className="ms-auto text-sm text-graphite">{date === today ? "النهارده" : date}</span>
              <ChevronDown className="size-4 text-graphite transition-transform group-open/more:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-4 px-4 pb-4">
              <Field label="تاريخ التسليم" htmlFor="date" error={errors.deliveredAt}>
                <Input id="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="ملاحظات" htmlFor="notes" optional>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" placeholder="مثال: استلمها أحمد من العميل" />
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
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Truck className="size-5" aria-hidden="true" />}
          <span>حفظ التسليم</span>
        </button>
      </div>
    </form>
  );
}
