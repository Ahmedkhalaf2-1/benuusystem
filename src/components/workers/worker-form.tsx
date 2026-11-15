"use client";

import { hueSubmit, STICKY_SUBMIT } from "@/components/ds/primitives";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { saveWorkerAction } from "@/app/(app)/workers/actions";
import { ChoiceCards } from "@/components/finance/choice-cards";
import { MoneyField } from "@/components/finance/money-field";
import { Field, FormMessage, NativeSelect, Textarea } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import type { WorkerJob, WorkUnit } from "@/generated/prisma/enums";
import { workerInputSchema } from "@/lib/validations/workers";
import { JOB_DEFAULTS, WORK_UNIT_LABELS, WORK_UNITS, WORKER_JOB_LABELS, WORKER_JOBS } from "@/lib/workers/labels";

export type WorkerFormInitial = {
  id: string;
  name: string;
  phone: string | null;
  job: WorkerJob;
  jobTitle: string | null;
  dailyWage: string;
  dailyTarget: number | null;
  targetUnit: WorkUnit | null;
  isActive: boolean;
  notes: string | null;
};

/** "عامل جديد" / edit worker. Only name, job and daily wage are required. */
export function WorkerForm({ worker }: { worker?: WorkerFormInitial }) {
  const [name, setName] = useState(worker?.name ?? "");
  const [phone, setPhone] = useState(worker?.phone ?? "");
  const [job, setJob] = useState<WorkerJob | "">(worker?.job ?? "");
  const [jobTitle, setJobTitle] = useState(worker?.jobTitle ?? "");
  const [dailyWage, setDailyWage] = useState(worker ? worker.dailyWage.replace(/\.00$/, "") : "");
  const [dailyTarget, setDailyTarget] = useState(worker?.dailyTarget ? String(worker.dailyTarget) : "");
  const [targetUnit, setTargetUnit] = useState<WorkUnit | "">(worker?.targetUnit ?? "");
  const [isActive, setIsActive] = useState(worker?.isActive ?? true);
  const [notes, setNotes] = useState(worker?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const values = {
      name,
      phone,
      job: job as WorkerJob,
      jobTitle,
      dailyWage,
      dailyTarget,
      targetUnit: (targetUnit || undefined) as WorkUnit | undefined,
      isActive,
      notes,
    };
    const check = workerInputSchema.safeParse(values);
    if (!check.success) {
      const fe: Record<string, string> = {};
      for (const i of check.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      setMessage("في بيانات ناقصة. راجع الخانات اللي باللون الأحمر.");
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      const result = await saveWorkerAction(worker?.id ?? null, values);
      if (result && !result.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) if (v[0]) fe[k] = v[0];
        setErrors(fe);
        setMessage(result.message);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4 sm:p-5">
      <Field label="اسم العامل" htmlFor="name" error={errors.name}>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: يوسف" aria-invalid={errors.name ? true : undefined} />
      </Field>
      <ChoiceCards
        label="الشغلانة"
        options={WORKER_JOBS.map((j) => ({ value: j, label: WORKER_JOB_LABELS[j] }))}
        value={job}
        onChange={(j) => {
          setJob(j);
          if (!targetUnit) setTargetUnit(JOB_DEFAULTS[j].unit);
        }}
        error={errors.job}
      />
      <Field label="اسم الشغلانة بطريقتك" htmlFor="jobTitle" optional hint="لو حابب تسميها اسم تاني، مثال: مكوجي">
        <Input id="jobTitle" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </Field>
      <Field label="اليومية" htmlFor="dailyWage" error={errors.dailyWage} hint={worker ? "تغيير اليومية بيأثر على الأيام الجاية بس، مش اللي فاتت." : undefined}>
        <MoneyField id="dailyWage" value={dailyWage} onChange={setDailyWage} invalid={!!errors.dailyWage} placeholder="مثال: 300" />
      </Field>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="المستهدف في اليوم" htmlFor="dailyTarget" optional error={errors.dailyTarget} hint="لقياس الإنتاجية بس، مش بيأثر على اليومية">
          <Input id="dailyTarget" inputMode="numeric" value={dailyTarget} onChange={(e) => setDailyTarget(e.target.value)} placeholder="مثال: 300" aria-invalid={errors.dailyTarget ? true : undefined} />
        </Field>
        <Field label="الوحدة" htmlFor="targetUnit" error={errors.targetUnit}>
          <NativeSelect id="targetUnit" value={targetUnit} onChange={(e) => setTargetUnit(e.target.value as WorkUnit)} className="w-28">
            <option value="">—</option>
            {WORK_UNITS.map((u) => (
              <option key={u} value={u}>
                {WORK_UNIT_LABELS[u]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="رقم الموبايل" htmlFor="phone" optional error={errors.phone}>
        <Input id="phone" type="tel" inputMode="tel" dir="ltr" className="text-left" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
      </Field>
      {worker && (
        <ChoiceCards
          label="الحالة"
          options={[
            { value: "active", label: "شغّال معانا" },
            { value: "inactive", label: "موقوف" },
          ]}
          value={isActive ? "active" : "inactive"}
          onChange={(v) => setIsActive(v === "active")}
        />
      )}
      <Field label="ملاحظات" htmlFor="notes" optional>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20" />
      </Field>
      <FormMessage message={message} />
      <div className={STICKY_SUBMIT}>
        <button type="submit" className={hueSubmit("violet")} disabled={pending}>
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        {worker ? "حفظ التعديلات" : "حفظ العامل"}
      </button>
      </div>
    </form>
  );
}
