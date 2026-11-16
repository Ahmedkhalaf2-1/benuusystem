"use client";

import { useActionState } from "react";
import { Archive, Loader2, RotateCcw } from "lucide-react";
import { archiveOrderAction, restoreOrderAction } from "@/app/(app)/orders/actions";
import { FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * «حذف الأوردر» (owner only). Never deletes: an untouched order is archived
 * (hidden from lists, totals and reports, kept with who/when/why). An order
 * with payments, costs, work, production or deliveries is refused, with the
 * reasons listed here before anyone tries.
 */
export function ArchiveOrderForm({ orderId, orderLabel, blockers }: { orderId: string; orderLabel: string; blockers: string[] }) {
  const [state, action, pending] = useActionState(archiveOrderAction, null);
  return (
    <details className="group rounded-2xl border border-line bg-surface p-4" data-testid="archive-order">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-red [&::-webkit-details-marker]:hidden">
        <Archive className="size-5" aria-hidden="true" />
        حذف الأوردر
      </summary>
      {blockers.length > 0 ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-semibold">مينفعش يتحذف — عليه:</p>
          <ul className="list-disc space-y-1 ps-5">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="text-graphite">لو السجلات دي اتسجلت غلط، ألغها الأول (بسبب) من مكانها، أو غيّر حالة الأوردر لـ «ملغي». الفلوس والإنتاج المتسجلين مش بيتمسحوا.</p>
        </div>
      ) : (
        <form action={action} className="mt-3 space-y-3 rounded-2xl bg-red-soft p-3.5 ring-1 ring-red/15">
          <input type="hidden" name="orderId" value={orderId} />
          <p className="text-sm">
            الأوردر {orderLabel} مفيهوش أي دفعات أو إنتاج أو تسليم. هيختفي من القوايم وحسابات العميل والتقارير، ويفضل محفوظ في «المحذوفة» ويتسجل مين حذفه وليه.
          </p>
          <label htmlFor={`archive-reason-${orderId}`} className="block text-sm font-medium">
            سبب الحذف
          </label>
          <Input id={`archive-reason-${orderId}`} name="reason" placeholder="مثال: أوردر تجربة / اتسجل مرتين" required minLength={3} />
          {state?.fieldErrors?.reason && <p className="text-sm text-red">{state.fieldErrors.reason[0]}</p>}
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" name="confirm" value="yes" required className="mt-0.5 size-4" />
            متأكد إني عايز أحذف الأوردر ده
          </label>
          <FormMessage message={state?.fieldErrors?.reason ? undefined : state?.message} />
          <Button type="submit" disabled={pending} className="w-full bg-danger-solid hover:opacity-90">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            تأكيد حذف الأوردر
          </Button>
        </form>
      )}
    </details>
  );
}

export function RestoreOrderForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(restoreOrderAction, null);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="outline" disabled={pending} className="h-11">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
        رجّع الأوردر
      </Button>
      <FormMessage message={state?.message} />
    </form>
  );
}
