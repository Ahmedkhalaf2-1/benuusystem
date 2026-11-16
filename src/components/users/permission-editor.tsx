"use client";

import { useActionState, useState } from "react";
import { Check, Eye, Loader2, Lock, PencilLine, Sparkles, TriangleAlert } from "lucide-react";
import { setActiveAction, revokeSessionsAction, updatePermissionsAction } from "@/app/(app)/users/actions";
import { FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  OWNER_ONLY_LABELS,
  PERMISSION_GROUPS,
  PERMISSION_INFO,
  PERMISSION_PRESETS,
  withDependencies,
  withoutDependents,
} from "@/lib/auth/permission-catalog";
import type { GrantablePermission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

function KindTag({ kind }: { kind: "read" | "write" }) {
  return kind === "read" ? (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-well px-2 text-[0.68rem] font-semibold text-graphite">
      <Eye className="size-3" aria-hidden="true" />
      يشوف
    </span>
  ) : (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-violet-soft px-2 text-[0.68rem] font-semibold text-violet">
      <PencilLine className="size-3" aria-hidden="true" />
      يغيّر
    </span>
  );
}

/**
 * Grouped checkboxes for one STAFF account. Ticking a change ("يغيّر") also
 * ticks what it needs to see; unticking a read also unticks what depends on
 * it, so the owner can never save a combination the server would refuse.
 */
export function PermissionEditor({ userId, initial, version }: { userId: string; initial: GrantablePermission[]; version: number }) {
  const [selected, setSelected] = useState<GrantablePermission[]>(initial);
  const [note, setNote] = useState<string>();
  const [state, action, pending] = useActionState(updatePermissionsAction, null);
  const removed = initial.filter((p) => !selected.includes(p));
  const dirty = removed.length > 0 || selected.some((p) => !initial.includes(p));

  function toggle(key: GrantablePermission, on: boolean) {
    const next = on ? withDependencies(selected, key) : withoutDependents(selected, key);
    const auto = on ? next.filter((k) => k !== key && !selected.includes(k)) : selected.filter((k) => k !== key && !next.includes(k));
    setNote(auto.length > 0 ? `${on ? "اتعلّم كمان" : "اتشال كمان"}: ${auto.map((k) => `«${PERMISSION_INFO[k].label}»`).join("، ")}` : undefined);
    setSelected(next);
  }

  return (
    <form action={action} className="space-y-4" data-testid="permission-editor">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="expectedVersion" value={version} />
      {selected.map((p) => (
        <input key={p} type="hidden" name="permissions" value={p} />
      ))}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="flex items-center gap-2 font-display font-semibold">
          <Sparkles className="size-4 text-violet" aria-hidden="true" />
          جاهز
        </h2>
        <p className="mt-1 text-xs text-graphite">اختيار سريع — وبعدها تقدر تعدّل أي صلاحية لوحدها.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PERMISSION_PRESETS.map((preset) => {
            const on = preset.permissions.length === selected.length && preset.permissions.every((p) => selected.includes(p));
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSelected([...preset.permissions]);
                  setNote(undefined);
                }}
                className={cn("rounded-2xl border p-3 text-start transition-colors", on ? "border-violet bg-violet-soft ring-1 ring-violet" : "border-line hover:border-line-strong")}
              >
                <span className="block text-sm font-semibold">{preset.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-graphite">{preset.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.key} className="rounded-2xl border border-line bg-surface p-4">
          <legend className="sr-only">{group.label}</legend>
          <h2 aria-hidden="true" className="font-display font-semibold">
            {group.label}
          </h2>
          <ul className="mt-2 divide-y divide-hairline">
            {group.items.map((item) => {
              const on = selected.includes(item.key);
              return (
                <li key={item.key}>
                  <label className="flex min-h-14 cursor-pointer items-start gap-3 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-5 shrink-0 accent-violet"
                      checked={on}
                      onChange={(e) => toggle(item.key, e.target.checked)}
                      data-permission={item.key}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold">{item.label}</span>
                        <KindTag kind={item.kind} />
                        {item.sensitive && (
                          <span className="inline-flex h-5 items-center rounded-full bg-warning-soft px-2 text-[0.68rem] font-semibold text-warning-ink">فلوس</span>
                        )}
                      </span>
                      {item.hint && <span className="mt-0.5 block text-xs leading-snug text-graphite">{item.hint}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      <section className="rounded-2xl bg-well p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="size-4" aria-hidden="true" />
          للمدير بس — مينفعش تتدي لموظف
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-graphite">{OWNER_ONLY_LABELS.join(" · ")}</p>
      </section>

      {note && (
        <p className="rounded-2xl bg-violet-soft px-3.5 py-2.5 text-sm text-ink" aria-live="polite">
          {note}
        </p>
      )}

      {removed.length > 0 && (
        <label className="flex items-start gap-2.5 rounded-2xl bg-warning-soft p-3.5 text-sm text-warning-ink">
          <input type="checkbox" name="revokeSessions" value="yes" className="mt-0.5 size-5 shrink-0" />
          <span>
            <b className="font-semibold">كمان اقفل دخوله من كل الأجهزة.</b> الصلاحيات اللي بتشيلها بتتشال من أول طلب جاي على أي حال؛ ده بيخليه يسجّل دخول من جديد.
          </span>
        </label>
      )}

      <FormMessage message={state?.message} />
      <div className="sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-line bg-surface p-1.5 lg:bottom-4">
        <Button type="submit" disabled={pending || !dirty} className="h-12 w-full rounded-xl font-display text-base">
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Check className="size-5" aria-hidden="true" />}
          حفظ الصلاحيات
        </Button>
      </div>
    </form>
  );
}

export function AccountStatusForm({ userId, active, version }: { userId: string; active: boolean; version: number }) {
  const [state, action, pending] = useActionState(setActiveAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="active" value={active ? "no" : "yes"} />
      {active && (
        <p className="flex items-start gap-2 text-xs text-graphite">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-ink" aria-hidden="true" />
          الإيقاف بيقفل دخوله فورًا من كل الأجهزة. صلاحياته بتفضل محفوظة لو رجّعته.
        </p>
      )}
      <FormMessage message={state?.message} />
      <Button type="submit" variant="outline" disabled={pending} className={cn("h-11 w-full rounded-xl", active && "text-red")}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {active ? "إيقاف الحساب" : "تفعيل الحساب"}
      </Button>
    </form>
  );
}

export function RevokeSessionsForm({ userId, sessions }: { userId: string; sessions: number }) {
  const [state, action, pending] = useActionState(revokeSessionsAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />
      <FormMessage message={state?.message} />
      <Button type="submit" variant="outline" disabled={pending || sessions === 0} className="h-11 w-full rounded-xl">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        تسجيل خروجه من كل الأجهزة
      </Button>
    </form>
  );
}
