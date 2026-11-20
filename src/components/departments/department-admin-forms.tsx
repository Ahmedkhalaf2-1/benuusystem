"use client";

import { useActionState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createDepartmentAction, revokeMembershipAction, setMembershipAction, updateDepartmentAction } from "@/app/(app)/departments/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MEMBERSHIP_FLAGS } from "@/lib/departments/labels";
import { cn } from "@/lib/utils";

const err = (state: { fieldErrors?: Record<string, string[]> } | null, key: string) => state?.fieldErrors?.[key]?.[0];

/** Owner: add a department (no code change needed). */
export function CreateDepartmentForm() {
  const [state, action, pending] = useActionState(createDepartmentAction, null);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Field label="قسم جديد" htmlFor="new-department" error={err(state, "name")}>
          <Input id="new-department" name="name" required maxLength={80} placeholder="مثال: هدايا ومطبوعات" aria-invalid={err(state, "name") ? true : undefined} />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="h-12 rounded-xl">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
        إضافة القسم
      </Button>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
    </form>
  );
}

/** Owner: rename a department, or switch it off/on. */
export function DepartmentSettingsForm({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const [state, action, pending] = useActionState(updateDepartmentAction, null);
  const [toggleState, toggle, toggling] = useActionState(updateDepartmentAction, null);
  return (
    <div className="space-y-2">
      <form action={action} className="flex items-end gap-2">
        <input type="hidden" name="departmentId" value={id} />
        <div className="flex-1">
          <Field label="اسم القسم" htmlFor={`dep-${id}`} error={err(state, "name")}>
            <Input id={`dep-${id}`} name="name" defaultValue={name} required maxLength={80} />
          </Field>
        </div>
        <Button type="submit" variant="outline" disabled={pending} className="h-12 rounded-xl">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          حفظ
        </Button>
      </form>
      <form action={toggle}>
        <input type="hidden" name="departmentId" value={id} />
        <input type="hidden" name="isActive" value={isActive ? "no" : "yes"} />
        <button type="submit" disabled={toggling} className={cn("text-sm font-semibold underline-offset-4 hover:underline", isActive ? "text-red" : "text-violet")}>
          {isActive ? "إيقاف القسم (البنود بتفضل زي ما هي، والأعضاء بيقفل دخولهم عليه)" : "تشغيل القسم تاني"}
        </button>
      </form>
      <FormMessage message={state?.fieldErrors ? undefined : (state?.message ?? toggleState?.message)} />
    </div>
  );
}

type Membership = { canViewWork: boolean; canViewMoney: boolean; canRecordProduction: boolean; canViewCollections: boolean; canViewSettlements: boolean } | null;

/**
 * Owner: one account's access to one department — three independent
 * switches. Saved with the account's id; the server re-checks everything.
 */
export function DepartmentAccessRow({ userId, departmentId, name, active, membership }: { userId: string; departmentId: string; name: string; active: boolean; membership: Membership }) {
  const [state, action, pending] = useActionState(setMembershipAction, null);
  const [revokeState, revoke, revoking] = useActionState(revokeMembershipAction, null);
  const values = membership ?? { canViewWork: true, canViewMoney: false, canRecordProduction: false, canViewCollections: false, canViewSettlements: false };
  return (
    <li className="rounded-2xl bg-well p-3.5" data-testid="department-access-row">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-display font-semibold">
          {name}
          {!active && <span className="ms-2 rounded-full bg-surface px-2 py-0.5 text-xs font-normal text-graphite ring-1 ring-hairline">متوقف</span>}
        </p>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", membership?.canViewWork ? "bg-violet-soft text-violet" : "bg-surface text-graphite ring-1 ring-hairline")}>
          {membership ? (membership.canViewWork ? "ليه دخول" : "الدخول مقفول") : "مالوش دخول"}
        </span>
      </div>
      <form action={action} className="space-y-2">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="departmentId" value={departmentId} />
        {MEMBERSHIP_FLAGS.map((f) => (
          <label key={f.key} className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-surface px-3 py-2.5">
            <input type="checkbox" name={f.key} defaultChecked={values[f.key]} className="mt-1 size-4" />
            <span>
              <span className="block text-sm font-semibold">{f.label}</span>
              <span className="block text-xs text-graphite">{f.hint}</span>
            </span>
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="submit" size="sm" disabled={pending} className="h-10 rounded-xl">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {membership ? "حفظ" : "إدي دخول على القسم"}
          </Button>
        </div>
        <FormMessage message={state?.message} />
      </form>
      {membership && (
        <form action={revoke} className="mt-2">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="departmentId" value={departmentId} />
          <button type="submit" disabled={revoking} className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-red hover:bg-red-soft">
            <Trash2 className="size-4" aria-hidden="true" />
            شيل الدخول على القسم ده
          </button>
          <FormMessage message={revokeState?.message} />
        </form>
      )}
    </li>
  );
}
