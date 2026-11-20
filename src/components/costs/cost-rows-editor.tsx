"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { recordCostEntriesAction, removeDraftCostAction } from "@/app/(app)/costs/actions";
import { Field, FormMessage, NativeSelect } from "@/components/forms/field";
import { MoneyInput } from "@/components/orders/order-form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CostCategory } from "@/generated/prisma/enums";
import { COST_CATEGORIES, COST_CATEGORY_LABELS } from "@/lib/finance/labels";
import { parseQuantity, usageTotalCents } from "@/lib/finance/usage";
import { formatMoney, parseMoney } from "@/lib/money";
import { SALE_UNITS } from "@/lib/orders/work-kinds";
import { newRequestId } from "@/lib/request-id";

type Option = { id: string; name: string };
type ItemOption = { id: string; label: string };

type Row = {
  /** Idempotency key of THIS row: a repeated submit never duplicates it; every new row gets its own. */
  key: string;
  category: CostCategory;
  description: string;
  orderGroupId: string;
  usageQuantity: string;
  usageUnit: string;
  usageUnitCost: string;
  amount: string;
  supplierId: string;
  costDate: string;
};

const newRow = (today: string, category: CostCategory = "MATERIALS"): Row => ({
  key: newRequestId(),
  category,
  description: "",
  orderGroupId: "",
  usageQuantity: "",
  usageUnit: "",
  usageUnitCost: "",
  amount: "",
  supplierId: "",
  costDate: today,
});

/** Row total in piasters: quantity × unit cost (exact, half up), or the typed total; null while incomplete. */
function rowCents(r: Row): bigint | null {
  const q = parseQuantity(r.usageQuantity);
  const u = r.usageUnitCost.trim() === "" ? null : parseMoney(r.usageUnitCost);
  if (q !== null && u !== null) return usageTotalCents(q, u);
  return r.amount.trim() === "" ? null : parseMoney(r.amount);
}

/**
 * Cost rows of ONE order («بنود التكلفة»). Add as many rows as needed with
 * «+ إضافة بند تكلفة» — each its own category, supplier and date — and save
 * them together as drafts (they become supplier payables when the costs are
 * closed). The server re-validates every row with exact arithmetic.
 */
export function CostRowsEditor({ orderId, items, suppliers, today }: { orderId: string; items: ItemOption[]; suppliers: Option[]; today: string }) {
  const [rows, setRows] = useState<Row[]>(() => [newRow(today)]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<Row>) => {
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`entries.${i}.`))));
  };
  const totals = rows.map(rowCents);
  const sum = totals.every((t) => t !== null) ? totals.reduce<bigint>((s, t) => s + t!, 0n) : null;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (pending) return;
    start(async () => {
      const r = await recordCostEntriesAction(
        orderId,
        rows.map((row) => ({
          idempotencyKey: row.key,
          category: row.category,
          description: row.description,
          materialName: row.category === "MATERIALS" ? row.description : undefined,
          orderGroupId: row.orderGroupId,
          usageQuantity: row.usageQuantity,
          usageUnit: row.usageUnit,
          usageUnitCost: row.usageUnitCost,
          amount: row.amount,
          supplierId: row.supplierId,
          costDate: row.costDate,
        })),
      );
      if (r && !r.ok) {
        setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
        setMessage(r.message ?? "راجع البنود اللي باللون الأحمر.");
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3" data-testid="cost-rows-editor">
      {rows.map((r, i) => {
        const e = (k: string) => errors[`entries.${i}.${k}`];
        const id = (k: string) => `row${i}-${k}`;
        const t = totals[i];
        return (
          <fieldset key={r.key} className="space-y-3 rounded-2xl border border-line p-3" data-testid="cost-row">
            <legend className="sr-only">بند تكلفة {i + 1}</legend>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-display font-semibold">
                <span className="tabular flex size-7 items-center justify-center rounded-lg bg-brand-solid text-sm text-on-brand" aria-hidden="true">
                  {i + 1}
                </span>
                بند تكلفة
              </p>
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((list) => list.filter((_, j) => j !== i))} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm text-red hover:bg-red-soft" aria-label={`شيل البند ${i + 1}`}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  شيل
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="نوع التكلفة" htmlFor={id("cat")} error={e("category")}>
                <NativeSelect id={id("cat")} value={r.category} onChange={(ev) => set(i, { category: ev.target.value as CostCategory })}>
                  {COST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {COST_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="الوصف" htmlFor={id("desc")} optional error={e("description") ?? e("materialName")}>
                <Input id={id("desc")} value={r.description} onChange={(ev) => set(i, { description: ev.target.value })} placeholder="مثال: ورق DTF، خيط تطريز، نقل للعميل" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="الكمية" htmlFor={id("q")} optional error={e("usageQuantity")}>
                <Input id={id("q")} inputMode="decimal" value={r.usageQuantity} onChange={(ev) => set(i, { usageQuantity: ev.target.value })} className="tabular" aria-invalid={e("usageQuantity") ? true : undefined} />
              </Field>
              <Field label="الوحدة" htmlFor={id("u")} optional error={e("usageUnit")}>
                <NativeSelect id={id("u")} value={r.usageUnit} onChange={(ev) => set(i, { usageUnit: ev.target.value })}>
                  <option value="">—</option>
                  {SALE_UNITS.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="تكلفة الوحدة" htmlFor={id("uc")} optional error={e("usageUnitCost")}>
                <MoneyInput id={id("uc")} value={r.usageUnitCost} onChange={(v) => set(i, { usageUnitCost: v })} invalid={!!e("usageUnitCost")} />
              </Field>
              <Field label="أو الإجمالي مباشرة" htmlFor={id("a")} optional error={e("amount")}>
                <MoneyInput id={id("a")} value={r.amount} onChange={(v) => set(i, { amount: v })} invalid={!!e("amount")} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="المورد" htmlFor={id("s")} optional error={e("supplierId")} hint="ممكن تحدده وقت القفل">
                <NativeSelect id={id("s")} value={r.supplierId} onChange={(ev) => set(i, { supplierId: ev.target.value })}>
                  <option value="">بعدين / من غير مورد</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="التاريخ" htmlFor={id("d")} error={e("costDate")}>
                <Input id={id("d")} type="date" max={today} value={r.costDate} onChange={(ev) => set(i, { costDate: ev.target.value })} />
              </Field>
              {items.length > 1 && (
                <Field label="سطر الأوردر" htmlFor={id("g")} optional error={e("orderGroupId")}>
                  <NativeSelect id={id("g")} value={r.orderGroupId} onChange={(ev) => set(i, { orderGroupId: ev.target.value })}>
                    <option value="">الأوردر كله</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
            <p className="flex items-baseline justify-between rounded-xl bg-well px-3 py-2 text-sm" aria-live="polite">
              <span className="text-graphite">إجمالي البند</span>
              <span className="tabular font-display font-semibold" data-testid={`cost-row-total-${i}`}>
                {t === null ? "—" : formatMoney(t)}
              </span>
            </p>
          </fieldset>
        );
      })}

      <button
        type="button"
        onClick={() => setRows((list) => [...list, newRow(today, "OTHER")])}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-[0.95rem] font-semibold text-brand hover:bg-brand-soft/40"
      >
        <Plus className="size-5" aria-hidden="true" />
        إضافة بند تكلفة
      </button>

      <p className="flex items-baseline justify-between rounded-2xl bg-panel px-4 py-3 text-on-panel">
        <span className="text-sm text-on-panel-muted">إجمالي البنود الجديدة ({rows.length})</span>
        <span className="tabular font-display text-xl font-semibold">{sum === null ? "—" : formatMoney(sum)}</span>
      </p>
      <FormMessage message={message} />
      <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        حفظ {rows.length > 1 ? `${rows.length} بنود` : "البند"} (مسودة لحد قفل التكاليف)
      </Button>
    </form>
  );
}

/** Removes one draft row (history keeps it as voided). */
export function RemoveDraftButton({ costId }: { costId: string }) {
  const [state, action, pending] = useActionState(removeDraftCostAction, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="costId" value={costId} />
      <button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-sm font-semibold text-red hover:bg-red-soft" aria-label="حذف المسودة">
        <Trash2 className="size-3.5" aria-hidden="true" />
        حذف
      </button>
      {state?.message && <span className="ms-2 text-xs text-red">{state.message}</span>}
    </form>
  );
}
