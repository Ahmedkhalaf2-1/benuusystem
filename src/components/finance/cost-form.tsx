"use client";

import { hueSubmit, STICKY_SUBMIT } from "@/components/ds/primitives";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { recordOrderCostAction } from "@/app/(app)/finance/actions";
import { Field, FormMessage, NativeSelect, Textarea } from "@/components/forms/field";
import { formatAmount, parseMoney } from "@/lib/money";
import { parseWholeNumber } from "@/lib/numbers";
import { Input } from "@/components/ui/input";
import type { CostCategory, PaymentMethod } from "@/generated/prisma/enums";
import { COST_CATEGORIES, COST_CATEGORY_LABELS, type PayStatus } from "@/lib/finance/labels";
import { newRequestId } from "@/lib/request-id";
import { recordOrderCostSchema } from "@/lib/validations/finance";
import { ChoiceCards } from "./choice-cards";
import { MoneyField } from "./money-field";
import { PayNowFields } from "./pay-now-fields";
import { defaultAccountId } from "@/components/treasury/account-field";
import type { AccountOption } from "@/lib/treasury/labels";
import { SupplierPicker, type SupplierChoice } from "./supplier-picker";

/** "إضافة تكلفة" — one short form; the supplier and the paid part are optional. */
/**
 * `departments`: the order's departments — a cost may be tagged with one (a
 * partner's job). «بالقطعة»: pieces × the agreed cost per piece (typed by the
 * owner) fills the amount.
 */
export function CostForm({ orderId, today, accounts = [], departments = [] }: { orderId: string; today: string; accounts?: AccountOption[]; departments?: { id: string; name: string }[] }) {
  const [departmentId, setDepartmentId] = useState("");
  const [perPiece, setPerPiece] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [requestId] = useState(newRequestId);
  const [category, setCategory] = useState<CostCategory | "">("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [costDate, setCostDate] = useState(today);
  const [supplier, setSupplier] = useState<SupplierChoice | null>(null);
  const [payStatus, setPayStatus] = useState<PayStatus | "">("");
  const [paidNow, setPaidNow] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [accountId, setAccountId] = useState(() => defaultAccountId(accounts));
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [scrollTick, setScrollTick] = useState(0);

  useEffect(() => {
    if (scrollTick) formRef.current?.querySelector('[aria-invalid="true"], [data-error="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollTick]);

  function show(fieldErrors: Record<string, string[]>, summary?: string) {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldErrors)) {
      const key = k.startsWith("supplier.") && k !== "supplier.phone" ? "supplier" : k;
      if (v[0]) flat[key] ??= v[0];
    }
    setErrors(flat);
    setMessage(summary);
    setScrollTick((n) => n + 1);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const payload = {
      orderId,
      idempotencyKey: requestId,
      category: category as CostCategory,
      description,
      amount,
      costDate,
      supplier: supplier
        ? supplier.mode === "existing"
          ? { mode: "existing" as const, id: supplier.id }
          : { mode: "new" as const, name: supplier.name, phone: supplier.phone }
        : { mode: "none" as const },
      payStatus: payStatus as PayStatus,
      paidNow,
      method,
      ...(payStatus === "FULL" || payStatus === "PARTIAL" ? { accountId } : {}),
      notes,
      ...(departmentId ? { departmentId } : {}),
      ...(perPiece ? { quantity, unitCost } : {}),
    };
    const check = recordOrderCostSchema.safeParse(payload);
    if (!check.success) {
      const fe: Record<string, string[]> = {};
      for (const issue of check.error.issues) (fe[issue.path.join(".") || "_form"] ??= []).push(issue.message);
      show(fe, "في بيانات ناقصة. راجع الخانات اللي باللون الأحمر.");
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      const result = await recordOrderCostAction(payload);
      if (result && !result.ok) show(result.fieldErrors ?? {}, result.message);
    });
  }

  const clear = (key: string) => setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-5 rounded-2xl bg-surface border border-line p-4 sm:p-5">
      <ChoiceCards
        label="نوع التكلفة"
        options={COST_CATEGORIES.map((c) => ({ value: c, label: COST_CATEGORY_LABELS[c] }))}
        value={category}
        onChange={(c) => {
          setCategory(c);
          clear("category");
        }}
        error={errors.category}
      />
      <Field label="وصف التكلفة" htmlFor="description" optional>
        <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثال: شراء قماش قطن" />
      </Field>
      {departments.length > 0 && (
        <Field label="القسم (لو ده شغل شريك أو ورشة لقسم)" htmlFor="departmentId" optional error={errors.departmentId}>
          <NativeSelect id="departmentId" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">من غير قسم</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={perPiece} onChange={(e) => setPerPiece(e.target.checked)} className="size-4" />
        بالقطعة (عدد القطع × تكلفة القطعة المتفق عليها)
      </label>
      {perPiece && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="عدد القطع" htmlFor="quantity" error={errors.quantity}>
            <Input
              id="quantity"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                const q = parseWholeNumber(e.target.value);
                const u = parseMoney(unitCost);
                if (q && u) setAmount(formatAmount(BigInt(q) * u).replace(/,/g, ""));
                clear("quantity");
              }}
              className="tabular"
              aria-invalid={errors.quantity ? true : undefined}
            />
          </Field>
          <Field label="تكلفة القطعة" htmlFor="unitCost" error={errors.unitCost}>
            <MoneyField
              id="unitCost"
              value={unitCost}
              onChange={(v) => {
                setUnitCost(v);
                const q = parseWholeNumber(quantity);
                const u = parseMoney(v);
                if (q && u) setAmount(formatAmount(BigInt(q) * u).replace(/,/g, ""));
                clear("unitCost");
              }}
              invalid={!!errors.unitCost}
            />
          </Field>
        </div>
      )}
      <Field label="المبلغ" htmlFor="amount" error={errors.amount} hint={perPiece ? "بيتحسب من العدد × تكلفة القطعة" : undefined}>
        <MoneyField
          id="amount"
          value={amount}
          onChange={(v) => {
            setAmount(v);
            clear("amount");
          }}
          invalid={!!errors.amount}
          placeholder="مثال: 14000"
        />
      </Field>
      <Field label="المورد" optional error={undefined}>
        <SupplierPicker
          value={supplier}
          onChange={(s) => {
            setSupplier(s);
            clear("supplier");
          }}
          error={errors.supplier}
          phoneError={errors["supplier.phone"]}
        />
      </Field>
      <PayNowFields
        amount={amount}
        payStatus={payStatus}
        paidNow={paidNow}
        method={method}
        accounts={accounts}
        accountId={accountId}
        errors={errors}
        onChange={(p) => {
          if (p.payStatus !== undefined) {
            setPayStatus(p.payStatus);
            clear("payStatus");
          }
          if (p.paidNow !== undefined) {
            setPaidNow(p.paidNow);
            clear("paidNow");
          }
          if (p.method !== undefined) setMethod(p.method);
          if (p.accountId !== undefined) {
            setAccountId(p.accountId);
            clear("accountId");
          }
        }}
      />
      <Field label="التاريخ" htmlFor="costDate" error={errors.costDate}>
        <Input id="costDate" type="date" value={costDate} max={today} onChange={(e) => setCostDate(e.target.value)} aria-invalid={errors.costDate ? true : undefined} />
      </Field>
      <Field label="ملاحظات" htmlFor="notes" optional>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20" placeholder="مثال: رقم الفاتورة" />
      </Field>
      <FormMessage message={message} />
      <div className={STICKY_SUBMIT}>
        <button type="submit" className={hueSubmit("amber")} disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جارٍ الحفظ…
          </>
        ) : (
          "حفظ التكلفة"
        )}
      </button>
      </div>
    </form>
  );
}
