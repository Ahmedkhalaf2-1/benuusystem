"use client";

import { useActionState, useState, useTransition } from "react";
import { EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { setHiddenFromDepartmentsAction, setItemValueSplitAction } from "@/app/(app)/departments/actions";
import { FormMessage, NativeSelect } from "@/components/forms/field";
import { MoneyInput } from "@/components/orders/order-form-parts";
import { Button } from "@/components/ui/button";
import { formatMoney, parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Owner: keep this order out of every department view (partners and members). */
export function HideFromDepartmentsForm({ orderId, hidden }: { orderId: string; hidden: boolean }) {
  const [state, action, pending] = useActionState(setHiddenFromDepartmentsAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-well p-3.5">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="hidden" value={hidden ? "no" : "yes"} />
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <EyeOff className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden="true" />
        {hidden ? "الأوردر ده مخفي عن الأقسام والشركاء (شغله وقيمته وتحصيله)." : "الأوردر ظاهر لأعضاء الأقسام اللي فيها بنوده."}
      </p>
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="h-10 rounded-xl">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {hidden ? "إظهاره للأقسام" : "إخفاؤه عن الأقسام"}
      </Button>
      <FormMessage message={state?.message} />
    </form>
  );
}

type Option = { id: string; name: string };

/**
 * Owner: split one item's value across departments. Amounts are typed by the
 * owner and must add up to the item's line total exactly (the server checks).
 */
export function ValueSplitForm({
  orderId,
  itemId,
  lineTotal,
  departments,
  initial,
  stale,
}: {
  orderId: string;
  itemId: string;
  lineTotal: string;
  departments: Option[];
  initial: { departmentId: string; amount: string }[];
  stale: boolean;
}) {
  const [rows, setRows] = useState(initial.length > 0 ? initial : []);
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  const total = parseMoney(lineTotal) ?? 0n;
  const sum = rows.reduce((s, r) => s + (parseMoney(r.amount) ?? 0n), 0n);
  const save = (shares: typeof rows) =>
    start(async () => {
      setMessage(undefined);
      const r = await setItemValueSplitAction({ orderId, orderGroupId: itemId, shares });
      if (r && !r.ok) setMessage(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.message);
    });

  return (
    <div className="space-y-2" data-testid="value-split">
      {stale && <p className="rounded-xl bg-warning-soft p-2.5 text-xs text-warning-ink">التقسيم القديم مش مساوي لقيمة البند الحالية (السعر أو الكمية اتغيروا) — قيمة البند «غير موزّعة» لحد ما تحفظ تقسيم جديد.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <NativeSelect aria-label="القسم" value={r.departmentId} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, departmentId: e.target.value } : y)))} className="h-11 flex-1">
            <option value="">اختار القسم</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
          <div className="w-36">
            <MoneyInput id={`split-${itemId}-${i}`} value={r.amount} onChange={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, amount: v } : y)))} />
          </div>
          <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="flex size-10 items-center justify-center rounded-full text-red hover:bg-red-soft" aria-label="شيل القسم ده">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setRows((x) => [...x, { departmentId: "", amount: "" }])} className="inline-flex h-9 items-center gap-1 text-sm font-semibold text-violet">
          <Plus className="size-4" aria-hidden="true" />
          قسم
        </button>
        {rows.length > 0 && (
          <span className={cn("tabular text-xs font-semibold", sum === total ? "text-success-ink" : "text-warning-ink")}>
            المجموع {formatMoney(sum)} من {formatMoney(total)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending || rows.length === 0} onClick={() => save(rows)} className="h-10 rounded-xl">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          حفظ التقسيم
        </Button>
        {initial.length > 0 && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => save([])} className="h-10 rounded-xl">
            امسح التقسيم (البند كله لقسمه)
          </Button>
        )}
      </div>
      <FormMessage message={message} />
    </div>
  );
}
