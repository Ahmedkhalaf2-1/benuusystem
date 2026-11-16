"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Check, EyeOff, Loader2, Search, ShieldAlert, Users, UserCheck, type LucideIcon } from "lucide-react";
import { updateOrderAccessAction } from "@/app/(app)/orders/actions";
import { FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrderVisibility } from "@/generated/prisma/enums";
import { ORDER_VISIBILITIES, VISIBILITY_HINTS, VISIBILITY_LABELS, type AssignableStaff, type OrderAccessValue } from "@/lib/orders/visibility";
import { cn } from "@/lib/utils";

const ICONS: Record<OrderVisibility, LucideIcon> = { PRIVATE: EyeOff, ALL_AUTHORIZED_STAFF: Users, SELECTED_STAFF: UserCheck };

/**
 * «ظهور الأوردر للعمال» (owner only). Picks app login accounts by their stable
 * user id — never payroll worker records. Used inside the order form and as a
 * stand-alone form on the order page.
 */
export function OrderVisibilityPicker({
  staff,
  value,
  onChange,
  error,
}: {
  staff: AssignableStaff[];
  value: OrderAccessValue;
  onChange: (next: OrderAccessValue) => void;
  error?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? staff.filter((s) => s.name.toLowerCase().includes(q) || s.email.includes(q)) : staff;
  }, [query, staff]);
  const selected = new Set(value.userIds);
  const toggle = (userId: string) =>
    onChange({ ...value, userIds: selected.has(userId) ? value.userIds.filter((u) => u !== userId) : [...value.userIds, userId] });

  return (
    <div className="space-y-3" data-testid="order-visibility">
      <div role="radiogroup" aria-label="ظهور الأوردر للعمال" className="grid gap-2 sm:grid-cols-3">
        {ORDER_VISIBILITIES.map((v) => {
          const Icon = ICONS[v];
          const on = value.visibility === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange({ ...value, visibility: v })}
              className={cn(
                "flex min-h-14 items-start gap-2.5 rounded-2xl border p-3 text-start transition-colors",
                on ? "border-violet bg-violet-soft text-ink ring-1 ring-violet" : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <Icon className={cn("mt-0.5 size-5 shrink-0", on ? "text-violet" : "text-graphite")} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug">{VISIBILITY_LABELS[v]}</span>
                <span className="block text-xs leading-snug text-graphite">{VISIBILITY_HINTS[v]}</span>
              </span>
            </button>
          );
        })}
      </div>

      {value.visibility === "SELECTED_STAFF" && (
        <div className="rounded-2xl bg-well p-3">
          {staff.length === 0 ? (
            <p className="text-sm text-graphite">مفيش حسابات موظفين نشطة لسه. الحسابات بتتعمل من السيرفر، وبعدها تديها صلاحيات من «إدارة المستخدمين والصلاحيات».</p>
          ) : (
            <>
              <label htmlFor={`${id}-q`} className="sr-only">
                دوّر على موظف
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-graphite" aria-hidden="true" />
                <Input id={`${id}-q`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="دوّر بالاسم أو الإيميل" className="h-11 ps-9" />
              </div>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto" aria-label="الموظفين">
                {shown.map((s) => {
                  const on = selected.has(s.id);
                  return (
                    <li key={s.id}>
                      <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2", on ? "bg-surface ring-1 ring-violet/40" : "hover:bg-surface")}>
                        <input type="checkbox" className="size-5 accent-violet" checked={on} onChange={() => toggle(s.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{s.name}</span>
                          <span dir="ltr" className="block truncate text-end text-xs text-graphite">
                            {s.email}
                          </span>
                        </span>
                        {!s.canViewOrders && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.7rem] font-semibold text-warning-ink" title="الحساب ده مالوش صلاحية «عرض الأوردرات»، فمش هيشوف الأوردر لحد ما تديهاله.">
                            <ShieldAlert className="size-3" aria-hidden="true" />
                            مالوش عرض أوردرات
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="px-2 py-3 text-sm text-graphite">مفيش نتايج.</li>}
              </ul>
              <p className="mt-2 text-xs text-graphite">
                مختار <b className="tabular text-ink">{value.userIds.length}</b>
              </p>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Owner-only stand-alone form on the order page. */
export function OrderVisibilityForm({
  orderId,
  staff,
  initial,
  version,
}: {
  orderId: string;
  staff: AssignableStaff[];
  initial: OrderAccessValue;
  version: number;
}) {
  const [value, setValue] = useState<OrderAccessValue>(initial);
  const [state, action, pending] = useActionState(updateOrderAccessAction, null);
  const dirty = value.visibility !== initial.visibility || value.userIds.length !== initial.userIds.length || value.userIds.some((u) => !initial.userIds.includes(u));
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="access" value={JSON.stringify({ visibility: value.visibility, userIds: value.visibility === "SELECTED_STAFF" ? value.userIds : [], expectedVersion: version })} />
      <OrderVisibilityPicker staff={staff} value={value} onChange={setValue} error={state?.fieldErrors?.["access.userIds"]?.[0]} />
      <FormMessage message={state?.fieldErrors?.["access.userIds"] ? undefined : state?.message} />
      <Button type="submit" disabled={pending || !dirty} className="h-12 w-full rounded-xl">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
        حفظ ظهور الأوردر
      </Button>
    </form>
  );
}
