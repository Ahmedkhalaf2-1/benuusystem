"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { createOrderAction, updateOrderAction } from "@/app/(app)/orders/actions";
import { Field, FormMessage, FormSection, NativeSelect, Textarea } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrderStatus, PaymentMethod, PrintOperation, QuantityUnit } from "@/generated/prisma/enums";
import { newGroupDraft, type GroupDraft, type OrderDraft } from "./order-draft";
import { formatMoney, parseMoney, toCents } from "@/lib/money";
import { formatNumber, parseWholeNumber } from "@/lib/numbers";
import {
  MATERIAL_SUGGESTIONS,
  NO_OPERATION_LABEL,
  OPERATION_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PRINT_OPERATIONS,
  PRODUCT_SUGGESTIONS,
  QUANTITY_UNITS,
  UNIT_LABELS,
} from "@/lib/orders/labels";
import { newRequestId } from "@/lib/request-id";
import { cn } from "@/lib/utils";
import { createOrderSchema, MAX_ORDER_GROUPS, updateOrderSchema } from "@/lib/validations/order";
import { CustomerPicker } from "./customer-picker";

type Props =
  | { mode: "create"; initial: OrderDraft; materialSuggestions: string[] }
  | {
      mode: "edit";
      initial: OrderDraft;
      materialSuggestions: string[];
      orderId: string;
      /** Order's updatedAt when this screen was opened (stale-edit protection). */
      version: string;
      /** Decimal string of valid payments so far. */
      paid: string;
      canEditPrice: boolean;
      canCancel: boolean;
    };

export function OrderForm(props: Props) {
  const { mode, initial } = props;
  const [draft, setDraft] = useState<OrderDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  // One key per form visit: a double tap or retried submit cannot create two orders.
  const [requestId] = useState(newRequestId);
  const formRef = useRef<HTMLFormElement>(null);
  const [scrollToError, setScrollToError] = useState(0);

  useEffect(() => {
    if (!scrollToError) return;
    const target = formRef.current?.querySelector('[aria-invalid="true"], [data-error="true"]');
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollToError]);

  const set = <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  };
  /** Patch may be a function of the group's LATEST state (safe for rapid taps). */
  const setGroup = (index: number, patch: Partial<GroupDraft> | ((g: GroupDraft) => Partial<GroupDraft>)) => {
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g, i) => (i === index ? { ...g, ...(typeof patch === "function" ? patch(g) : patch) } : g)),
    }));
    setErrors((e) => ({ ...e, groups: "", [`groups.${index}.operations`]: "", [`groups.${index}.quantity`]: "" }));
  };

  const multiple = draft.groups.length > 1;
  const orderQuantity = parseWholeNumber(draft.quantity);
  const groupSum = draft.groups.reduce((sum, g) => sum + (parseWholeNumber(g.quantity) ?? 0), 0);

  const money = useMemo(() => {
    const total = parseMoney(draft.totalPrice);
    const already = mode === "edit" ? toCents(props.mode === "edit" ? props.paid : "0") : 0n;
    const advance = mode === "create" ? (draft.advance.trim() === "" ? 0n : parseMoney(draft.advance)) : 0n;
    const paidNow = advance === null ? null : already + advance;
    return { total, paidNow, remaining: total !== null && paidNow !== null ? total - paidNow : null };
  }, [draft.totalPrice, draft.advance, mode, props]);

  function buildPayload() {
    const customer = draft.customer
      ? draft.customer.mode === "existing"
        ? { mode: "existing" as const, id: draft.customer.id }
        : { mode: "new" as const, name: draft.customer.name, phone: draft.customer.phone }
      : undefined;
    const common = {
      customer: customer as NonNullable<typeof customer>,
      title: draft.title,
      productType: draft.productType,
      material: draft.material,
      quantity: draft.quantity,
      unit: draft.unit,
      groups: draft.groups.map((g) => ({
        ...(props.mode === "edit" && g.id ? { id: g.id } : {}),
        quantity: g.quantity,
        material: g.material,
        operations: g.operations,
        plain: g.plain,
        notes: g.notes,
      })),
      totalPrice: draft.totalPrice,
      receivedDate: draft.receivedDate,
      deliveryDate: draft.deliveryDate,
      notes: draft.notes,
    };
    return props.mode === "create"
      ? { ...common, idempotencyKey: requestId, advance: draft.advance, advanceMethod: draft.advanceMethod }
      : {
          ...common,
          orderId: props.orderId,
          expectedUpdatedAt: props.version,
          status: draft.status as "NEW" | "IN_PROGRESS" | "CANCELLED",
        };
  }

  function showErrors(fieldErrors: Record<string, string[] | string>, summary?: string) {
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(fieldErrors)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (!first) continue;
      // Customer sub-fields are shown on the picker.
      const target = key.startsWith("customer.") && key !== "customer.phone" ? "customer" : key;
      flat[target] ??= first;
    }
    setErrors(flat);
    setMessage(summary);
    setScrollToError((n) => n + 1);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const payload = buildPayload();

    // Same rules as the server, for instant feedback.
    const schema = props.mode === "create" ? createOrderSchema : updateOrderSchema;
    const check = schema.safeParse(payload);
    if (!check.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of check.error.issues) {
        const key = issue.path.length ? issue.path.join(".") : "_form";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      if (!draft.customer) fieldErrors.customer = ["اختار العميل أو اكتب اسم عميل جديد"];
      showErrors(fieldErrors, "في بيانات ناقصة أو محتاجة تتصلح. راجع الخانات اللي باللون الأحمر.");
      return;
    }

    setMessage(undefined);
    startTransition(async () => {
      const result =
        props.mode === "create"
          ? await createOrderAction(payload as Parameters<typeof createOrderAction>[0])
          : await updateOrderAction(payload as Parameters<typeof updateOrderAction>[0]);
      // On success the action redirects; we only get here on failure.
      if (result && !result.ok) showErrors(result.fieldErrors ?? {}, result.message);
    });
  }

  const materialOptions = useMemo(
    () => [...new Set([...props.materialSuggestions, ...MATERIAL_SUGGESTIONS])],
    [props.materialSuggestions],
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
      <datalist id="product-suggestions">
        {PRODUCT_SUGGESTIONS.map((p) => (
          <option key={p.name} value={p.name} />
        ))}
      </datalist>
      <datalist id="material-suggestions">
        {materialOptions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {/* 1 — Customer & order name */}
      <FormSection title="العميل والأوردر">
        <Field label="اسم العميل" error={undefined}>
          <CustomerPicker
            value={draft.customer}
            onChange={(customer) => {
              set("customer", customer);
              setErrors((e) => ({ ...e, customer: "", "customer.phone": "" }));
            }}
            error={errors.customer}
            phoneError={errors["customer.phone"]}
          />
        </Field>
        <Field label="اسم الأوردر" htmlFor="title" error={errors.title} hint="اسم يفكّرك بالأوردر، مثال: تيشيرتات محمود">
          <Input
            id="title"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="مثال: تيشيرتات محمود"
            aria-invalid={errors.title ? true : undefined}
          />
        </Field>
      </FormSection>

      {/* 2 — Product */}
      <FormSection title="المنتج">
        <Field label="نوع المنتج" htmlFor="productType" error={errors.productType}>
          <Input
            id="productType"
            list="product-suggestions"
            value={draft.productType}
            onChange={(e) => {
              const value = e.target.value;
              set("productType", value);
              const known = PRODUCT_SUGGESTIONS.find((p) => p.name === value.trim());
              if (known) set("unit", known.unit);
            }}
            placeholder="مثال: تيشيرت"
            aria-invalid={errors.productType ? true : undefined}
          />
        </Field>
        <Field label="نوع الخامة" htmlFor="material" error={errors.material} hint="اختار من القائمة أو اكتب خامة جديدة">
          <Input
            id="material"
            list="material-suggestions"
            value={draft.material}
            onChange={(e) => set("material", e.target.value)}
            placeholder="مثال: قطن 100%"
            aria-invalid={errors.material ? true : undefined}
          />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="الكمية المطلوبة" htmlFor="quantity" error={errors.quantity}>
            <Input
              id="quantity"
              inputMode="numeric"
              value={draft.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              placeholder="مثال: 200"
              className="text-lg font-semibold"
              aria-invalid={errors.quantity ? true : undefined}
            />
          </Field>
          <Field label="الوحدة" htmlFor="unit">
            <NativeSelect id="unit" value={draft.unit} onChange={(e) => set("unit", e.target.value as QuantityUnit)} className="w-28">
              {QUANTITY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </FormSection>

      {/* 3 — Printing & embroidery */}
      <FormSection title="الطباعة والتطريز">
        {!multiple && <p className="-mt-2 text-sm text-muted-foreground">اختار الشغل المطلوب. ينفع تختار أكتر من نوع (مثلًا DTF + تطريز).</p>}

        <div className="space-y-4">
          {draft.groups.map((group, index) => (
            <div key={group.key} className={cn(multiple && "space-y-3 rounded-xl border bg-background p-3")}>
              {multiple && (
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">مجموعة {index + 1}</h3>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, groups: d.groups.filter((_, i) => i !== index) }))}
                    className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-destructive hover:bg-destructive/10"
                    aria-label={`حذف مجموعة ${index + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    حذف
                  </button>
                </div>
              )}

              {multiple && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="الكمية" htmlFor={`g${index}-qty`} error={errors[`groups.${index}.quantity`]}>
                    <Input
                      id={`g${index}-qty`}
                      inputMode="numeric"
                      value={group.quantity}
                      onChange={(e) => setGroup(index, { quantity: e.target.value })}
                      className="text-lg font-semibold"
                      aria-invalid={errors[`groups.${index}.quantity`] ? true : undefined}
                    />
                  </Field>
                  <Field label="الخامة" htmlFor={`g${index}-mat`}>
                    <Input
                      id={`g${index}-mat`}
                      list="material-suggestions"
                      value={group.material}
                      onChange={(e) => setGroup(index, { material: e.target.value })}
                      placeholder={draft.material || "نفس خامة الأوردر"}
                    />
                  </Field>
                </div>
              )}

              <OperationPicker
                group={group}
                error={errors[`groups.${index}.operations`]}
                onChange={(patch) => setGroup(index, patch)}
              />

              {multiple && (
                <Field label="ملاحظات المجموعة" htmlFor={`g${index}-notes`} optional>
                  <Input
                    id={`g${index}-notes`}
                    value={group.notes}
                    onChange={(e) => setGroup(index, { notes: e.target.value })}
                    placeholder="مثال: لوجو على الضهر"
                  />
                </Field>
              )}
            </div>
          ))}
        </div>

        {multiple && (
          <div
            data-error={errors.groups ? "true" : undefined}
            className={cn(
              "rounded-xl p-3 text-sm font-medium",
              orderQuantity !== null && groupSum === orderQuantity ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900",
            )}
          >
            المتوزّع على المجموعات: {formatNumber(groupSum)} من {orderQuantity !== null ? formatNumber(orderQuantity) : "—"}
            {orderQuantity !== null && groupSum !== orderQuantity && (
              <span> — {groupSum < orderQuantity ? `فاضل ${formatNumber(orderQuantity - groupSum)}` : `زيادة ${formatNumber(groupSum - orderQuantity)}`}</span>
            )}
            {errors.groups && <p className="mt-1 text-destructive">{errors.groups}</p>}
          </div>
        )}

        {draft.groups.length < MAX_ORDER_GROUPS && (
          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed"
            onClick={() =>
              setDraft((d) => {
                const groups = d.groups.map((g, i) =>
                  // Splitting for the first time: the first group starts with the whole quantity.
                  d.groups.length === 1 && i === 0 && !g.quantity ? { ...g, quantity: d.quantity } : g,
                );
                return { ...d, groups: [...groups, newGroupDraft()] };
              })
            }
          >
            <Plus className="size-5" aria-hidden="true" />
            إضافة مجموعة تانية
          </Button>
        )}
        {!multiple && (
          <p className="text-xs text-muted-foreground">
            لو جزء من الكمية شغله مختلف (مثلًا 100 DTF و 50 تطريز)، دوس «إضافة مجموعة تانية».
          </p>
        )}
      </FormSection>

      {/* 4 — Money */}
      <FormSection title="الحساب">
        <Field
          label="إجمالي سعر الأوردر"
          htmlFor="totalPrice"
          error={errors.totalPrice}
          hint={props.mode === "edit" && !props.canEditPrice ? "تعديل السعر للمدير بس" : undefined}
        >
          <MoneyInput
            id="totalPrice"
            value={draft.totalPrice}
            onChange={(v) => set("totalPrice", v)}
            invalid={!!errors.totalPrice}
            disabled={props.mode === "edit" && !props.canEditPrice}
          />
        </Field>

        {props.mode === "create" && (
          <>
            <Field label="المقدم المستلم" htmlFor="advance" error={errors.advance} hint="لو العميل مدفعش مقدم سيبها فاضية">
              <MoneyInput id="advance" value={draft.advance} onChange={(v) => set("advance", v)} invalid={!!errors.advance} placeholder="0" />
            </Field>
            {money.paidNow !== null && money.paidNow > 0n && (
              <Field label="طريقة دفع المقدم" htmlFor="advanceMethod">
                <NativeSelect id="advanceMethod" value={draft.advanceMethod} onChange={(e) => set("advanceMethod", e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </>
        )}
        {props.mode === "edit" && (
          <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
            <span className="text-sm text-muted-foreground">المدفوع لحد دلوقتي</span>
            <span className="font-semibold">{formatMoney(toCents(props.paid))}</span>
          </div>
        )}

        <div className="flex items-center justify-between rounded-xl bg-brand-soft px-4 py-3">
          <span className="font-medium">المتبقي</span>
          <span
            className={cn("text-2xl font-bold", money.remaining !== null && money.remaining < 0n ? "text-destructive" : "text-primary")}
            aria-live="polite"
          >
            {money.remaining !== null ? formatMoney(money.remaining) : "—"}
          </span>
        </div>
      </FormSection>

      {/* 5 — Dates & notes */}
      <FormSection title="المواعيد والملاحظات">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تاريخ استلام الأوردر" htmlFor="receivedDate" error={errors.receivedDate}>
            <Input
              id="receivedDate"
              type="date"
              value={draft.receivedDate}
              onChange={(e) => set("receivedDate", e.target.value)}
              aria-invalid={errors.receivedDate ? true : undefined}
            />
          </Field>
          <Field label="موعد التسليم" htmlFor="deliveryDate" error={errors.deliveryDate} hint="الميعاد اللي اتفقت عليه مع العميل">
            <Input
              id="deliveryDate"
              type="date"
              value={draft.deliveryDate}
              min={draft.receivedDate || undefined}
              onChange={(e) => set("deliveryDate", e.target.value)}
              aria-invalid={errors.deliveryDate ? true : undefined}
            />
          </Field>
        </div>
        <Field label="ملاحظات" htmlFor="notes" optional>
          <Textarea id="notes" value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="أي تفاصيل زيادة: المقاسات، الألوان، مكان الطباعة…" />
        </Field>
        {props.mode === "edit" && (
          <Field label="حالة الأوردر" htmlFor="status" error={errors.status}>
            <NativeSelect id="status" value={draft.status} onChange={(e) => set("status", e.target.value as OrderStatus)}>
              <option value="NEW">{ORDER_STATUS_LABELS.NEW}</option>
              <option value="IN_PROGRESS">{ORDER_STATUS_LABELS.IN_PROGRESS}</option>
              {(props.canCancel || draft.status === "CANCELLED") && <option value="CANCELLED">{ORDER_STATUS_LABELS.CANCELLED}</option>}
            </NativeSelect>
          </Field>
        )}
      </FormSection>

      <FormMessage message={message} />

      <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جارٍ الحفظ…
          </>
        ) : mode === "create" ? (
          "حفظ الأوردر"
        ) : (
          "حفظ التعديلات"
        )}
      </Button>
    </form>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "مثال: 40000"}
        className="pe-3.5 ps-14 text-left text-xl font-bold placeholder:text-base placeholder:font-normal"
        aria-invalid={invalid ? true : undefined}
        disabled={disabled}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted-foreground">ج.م</span>
    </div>
  );
}

/** Big tappable cards. DTF/screen/embroidery combine; "none" is exclusive. */
function OperationPicker({
  group,
  error,
  onChange,
}: {
  group: GroupDraft;
  error?: string;
  onChange: (patch: (latest: GroupDraft) => Partial<GroupDraft>) => void;
}) {
  // Computed from the latest state, so two quick taps never lose a selection.
  const toggle = (op: PrintOperation) =>
    onChange((latest) => ({
      plain: false,
      operations: latest.operations.includes(op) ? latest.operations.filter((o) => o !== op) : [...latest.operations, op],
    }));
  const card = (selected: boolean) =>
    cn(
      "flex min-h-14 items-center gap-2.5 rounded-xl border-2 px-3 text-start text-[0.95rem] font-semibold transition-colors",
      selected ? "border-primary bg-brand-soft text-primary" : "border-border bg-surface text-foreground hover:border-primary/40",
    );
  const tick = (selected: boolean) => (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border-2",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
      )}
    >
      {selected && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  );

  return (
    <div data-error={error ? "true" : undefined}>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="نوع الشغل">
        {PRINT_OPERATIONS.map((op) => {
          const selected = group.operations.includes(op);
          return (
            <button key={op} type="button" role="checkbox" aria-checked={selected} onClick={() => toggle(op)} className={card(selected)}>
              {tick(selected)}
              {OPERATION_LABELS[op]}
            </button>
          );
        })}
        <button
          type="button"
          role="checkbox"
          aria-checked={group.plain}
          onClick={() => onChange((latest) => ({ plain: !latest.plain, operations: [] }))}
          className={cn(card(group.plain), "text-sm")}
        >
          {tick(group.plain)}
          {NO_OPERATION_LABEL}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
