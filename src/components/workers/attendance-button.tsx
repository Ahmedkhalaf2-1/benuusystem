"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { recordWorkdayAction } from "@/app/(app)/workers/actions";
import { newRequestId } from "@/lib/request-id";

/** One tap: "حضر النهارده". Idempotent per render, so a double tap records once. */
export function AttendanceButton({ workerId, today }: { workerId: string; today: string }) {
  const [state, action, pending] = useActionState(recordWorkdayAction, null);
  const [key] = useState(newRequestId);
  return (
    <form action={action}>
      <input type="hidden" name="workerId" value={workerId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="workDate" value={today} />
      <input type="hidden" name="worked" value="true" />
      <input type="hidden" name="from" value="list" />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-brand-solid px-4 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
        حضر النهارده
      </button>
      {state?.message && <p className="mt-1 text-xs text-red">{state.message}</p>}
    </form>
  );
}
