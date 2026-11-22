"use client";

import { useActionState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus } from "lucide-react";
import { createPresetAction, updatePresetAction } from "@/app/(app)/orders/presets/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function CreatePresetForm() {
  const [state, action, pending] = useActionState(createPresetAction, null);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Field label="منتج جاهز جديد" htmlFor="new-preset" error={state?.fieldErrors?.name?.[0]}>
          <Input id="new-preset" name="name" required maxLength={80} placeholder="مثال: جاكيت، مج، شنطة قماش" />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="h-12 rounded-xl">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
        إضافة
      </Button>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
    </form>
  );
}

export function PresetRow({ id, name, isActive, first, last }: { id: string; name: string; isActive: boolean; first: boolean; last: boolean }) {
  const [state, action, pending] = useActionState(updatePresetAction, null);
  return (
    <li className={cn("rounded-2xl border border-line bg-surface p-3", !isActive && "opacity-70")}>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="presetId" value={id} />
        <div className="min-w-40 flex-1">
          <Field label="الاسم" htmlFor={`preset-${id}`} error={state?.fieldErrors?.name?.[0]}>
            <Input id={`preset-${id}`} name="name" defaultValue={name} required maxLength={80} />
          </Field>
        </div>
        <Button type="submit" variant="outline" disabled={pending} className="h-12 rounded-xl">
          حفظ
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {[
          { move: "-1", label: "لفوق", icon: ArrowUp, disabled: first },
          { move: "1", label: "لتحت", icon: ArrowDown, disabled: last },
        ].map((m) => (
          <form key={m.move} action={action}>
            <input type="hidden" name="presetId" value={id} />
            <input type="hidden" name="move" value={m.move} />
            <button type="submit" disabled={m.disabled || pending} className="flex size-9 items-center justify-center rounded-full text-graphite hover:bg-well disabled:opacity-30" aria-label={`حرّك ${name} ${m.label}`}>
              <m.icon className="size-4" aria-hidden="true" />
            </button>
          </form>
        ))}
        <form action={action} className="ms-auto">
          <input type="hidden" name="presetId" value={id} />
          <input type="hidden" name="isActive" value={isActive ? "no" : "yes"} />
          <button type="submit" disabled={pending} className={cn("text-sm font-semibold", isActive ? "text-red" : "text-violet")}>
            {isActive ? "إخفاء من الفورم" : "إظهار في الفورم"}
          </button>
        </form>
      </div>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
    </li>
  );
}

/** Owner: default roll width of DTF / vinyl (cm). Empty = typed per line; nothing is assumed. */
