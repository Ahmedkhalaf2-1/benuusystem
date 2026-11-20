"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2, Lock, Pencil } from "lucide-react";
import { amendCostEntryAction, closeOrderCostsAction, reopenOrderCostsAction } from "@/app/(app)/costs/actions";
import { Field, FormMessage, NativeSelect } from "@/components/forms/field";
import { MoneyInput } from "@/components/orders/order-form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseQuantity, usageTotalCents } from "@/lib/finance/usage";
import { formatMoney, parseMoney } from "@/lib/money";
import { SALE_UNITS } from "@/lib/orders/work-kinds";

type Option = { id: string; name: string };

function flat(fieldErrors?: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""]));
}

/** Live total: quantity × unit cost (exact, half-up), or the typed amount. */
function liveTotal(qty: string, unitCost: string, amount: string): string {
  const q = parseQuantity(qty);
  const u = unitCost.trim() === "" ? null : parseMoney(unitCost);
  if (q !== null && u !== null) return formatMoney(usageTotalCents(q, u));
  const a = amount.trim() === "" ? null : parseMoney(amount);
  return a === null ? "—" : formatMoney(a);
}

/** Owner: close the order's costs — a supplier for every draft (or «من غير مورد»), or confirm zero costs. */
export function CloseCostsForm({ orderId, version, drafts, suppliers, hasEntries }: { orderId: string; version: number; drafts: { id: string; label: string; amount: string; supplierId: string | null }[]; suppliers: Option[]; hasEntries: boolean }) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [zero, setZero] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  const need = drafts.filter((d) => !d.supplierId);
  const submit = () =>
    start(async () => {
      const r = await closeOrderCostsAction({ orderId, expectedVersion: version, suppliers: picks, confirmZero: zero });
      if (r && !r.ok) {
        setErrors(flat(r.fieldErrors));
        setMessage(r.message);
      }
    });
  return (
    <div className="space-y-3" data-testid="close-costs">
      {need.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">مين المورد لكل تكلفة؟</p>
          {need.map((d) => (
            <Field key={d.id} label={`${d.label} — ${d.amount}`} htmlFor={`pick-${d.id}`} error={errors[`suppliers.${d.id}`]}>
              <NativeSelect id={`pick-${d.id}`} value={picks[d.id] ?? ""} onChange={(e) => setPicks((p) => ({ ...p, [d.id]: e.target.value }))}>
                <option value="">اختار</option>
                <option value="none">من غير مورد (مش هيتسجل علينا لحد)</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ))}
        </div>
      )}
      {!hasEntries && (
        <label className="flex items-start gap-2 rounded-xl bg-well p-3 text-sm font-semibold" data-error={errors.confirmZero ? "true" : undefined}>
          <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} className="mt-1 size-4" />
          أكّد إن الأوردر ده مالوش أي تكلفة فعلًا (تكلفة صفر).
        </label>
      )}
      {errors.confirmZero && <p className="text-sm text-red">{errors.confirmZero}</p>}
      <p className="text-xs text-graphite">بالقفل: كل تكلفة بتتسجل مستحقة للمورد بتاعها (مش دفع). الدفع للمورد من صفحته زي ما هو.</p>
      <FormMessage message={message} />
      <Button type="button" onClick={submit} disabled={pending} className="h-12 w-full rounded-xl">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
        قفل التكاليف
      </Button>
    </div>
  );
}

export function ReopenCostsForm({ orderId, version }: { orderId: string; version: number }) {
  const [state, action, pending] = useActionState(reopenOrderCostsAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <Field label="سبب فتح التكاليف تاني" htmlFor="reopen-reason" error={state?.fieldErrors?.reason?.[0]}>
        <Input id="reopen-reason" name="reason" required minLength={3} />
      </Field>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      <Button type="submit" variant="outline" disabled={pending} className="h-11 rounded-xl">
        فتح التكاليف
      </Button>
    </form>
  );
}

/** Correct one entry in place (posted / closed entries: owner, with a reason). */
export function AmendEntryForm({
  orderId,
  entry,
  suppliers,
  needsReason,
  today,
}: {
  orderId: string;
  entry: { id: string; version: number; usageQuantity: string | null; usageUnit: string | null; usageUnitCost: string | null; amount: string; supplierId: string | null; costDate: string; materialName: string | null; materialVariant: string | null; notes: string | null };
  suppliers: Option[];
  needsReason: boolean;
  today: string;
}) {
  const [v, setV] = useState({
    usageQuantity: entry.usageQuantity ?? "",
    usageUnit: entry.usageUnit ?? "",
    usageUnitCost: entry.usageUnitCost ?? "",
    amount: entry.usageQuantity ? "" : entry.amount,
    supplierId: entry.supplierId ?? "",
    costDate: entry.costDate,
    materialName: entry.materialName ?? "",
    materialVariant: entry.materialVariant ?? "",
    notes: entry.notes ?? "",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }));
  const submit = () =>
    start(async () => {
      const r = await amendCostEntryAction(orderId, { costId: entry.id, expectedVersion: entry.version, ...v, supplierId: v.supplierId || null, amount: v.amount || undefined, usageQuantity: v.usageQuantity || undefined, usageUnit: v.usageUnit || undefined, usageUnitCost: v.usageUnitCost || undefined });
      if (r && !r.ok) {
        setErrors(flat(r.fieldErrors));
        setMessage(r.fieldErrors ? undefined : r.message);
      }
    });
  return (
    <details className="group rounded-xl bg-well px-3">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-violet [&::-webkit-details-marker]:hidden">
        <Pencil className="size-3.5" aria-hidden="true" />
        تعديل
      </summary>
      <div className="space-y-3 pt-1 pb-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="الخامة" htmlFor={`am-mat-${entry.id}`}>
            <Input id={`am-mat-${entry.id}`} value={v.materialName} onChange={(e) => set("materialName", e.target.value)} />
          </Field>
          <Field label="المواصفة" htmlFor={`am-var-${entry.id}`}>
            <Input id={`am-var-${entry.id}`} value={v.materialVariant} onChange={(e) => set("materialVariant", e.target.value)} />
          </Field>
          <Field label="الكمية" htmlFor={`am-q-${entry.id}`} error={errors.usageQuantity}>
            <Input id={`am-q-${entry.id}`} inputMode="decimal" value={v.usageQuantity} onChange={(e) => set("usageQuantity", e.target.value)} className="tabular" />
          </Field>
          <Field label="الوحدة" htmlFor={`am-u-${entry.id}`} error={errors.usageUnit}>
            <NativeSelect id={`am-u-${entry.id}`} value={v.usageUnit} onChange={(e) => set("usageUnit", e.target.value)}>
              <option value="">—</option>
              {SALE_UNITS.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="تكلفة الوحدة" htmlFor={`am-uc-${entry.id}`} error={errors.usageUnitCost}>
            <MoneyInput id={`am-uc-${entry.id}`} value={v.usageUnitCost} onChange={(x) => set("usageUnitCost", x)} />
          </Field>
          <Field label="أو الإجمالي" htmlFor={`am-a-${entry.id}`} error={errors.amount}>
            <MoneyInput id={`am-a-${entry.id}`} value={v.amount} onChange={(x) => set("amount", x)} />
          </Field>
          <Field label="المورد" htmlFor={`am-s-${entry.id}`} error={errors.supplierId}>
            <NativeSelect id={`am-s-${entry.id}`} value={v.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
              <option value="">من غير مورد</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="التاريخ" htmlFor={`am-d-${entry.id}`} error={errors.costDate}>
            <Input id={`am-d-${entry.id}`} type="date" max={today} value={v.costDate} onChange={(e) => set("costDate", e.target.value)} />
          </Field>
        </div>
        <p className="tabular text-sm">الإجمالي الجديد: {liveTotal(v.usageQuantity, v.usageUnitCost, v.amount)}</p>
        {needsReason && (
          <Field label="سبب التعديل" htmlFor={`am-r-${entry.id}`} error={errors.reason}>
            <Input id={`am-r-${entry.id}`} value={v.reason} onChange={(e) => set("reason", e.target.value)} />
          </Field>
        )}
        <FormMessage message={message} />
        <Button type="button" size="sm" onClick={submit} disabled={pending} className="h-10 rounded-xl">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          حفظ التعديل
        </Button>
      </div>
    </details>
  );
}
