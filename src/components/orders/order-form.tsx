"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarDays, Check, ChevronDown, Layers, Loader2, Minus, Package, Plus, Printer, Shirt, Smartphone, Trash2, TriangleAlert, User, Wallet, type LucideIcon } from "lucide-react";
import { createOrderAction, updateOrderAction } from "@/app/(app)/orders/actions";
import { Field, FormMessage, NativeSelect, Textarea } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrderStatus, PaymentMethod, PrintOperation, QuantityUnit } from "@/generated/prisma/enums";
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
import { isClothingProduct } from "@/lib/orders/sizes";
import { dateFromString, dateToString, isValidDateString, todayDateString } from "@/lib/dates";
import { newRequestId } from "@/lib/request-id";
import { cn } from "@/lib/utils";
import { createOrderSchema, MAX_ORDER_GROUPS, updateOrderSchema } from "@/lib/validations/order";
import { CustomerPicker } from "./customer-picker";
import { newGroupDraft, type GroupDraft, type OrderDraft } from "./order-draft";
import { SizeGrid } from "./size-grid";

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
      orderLabel?: string;
    };

/** Product shortcuts shown as tiles (the input still accepts anything). */
const PRODUCT_TILES = ["تيشيرت", "هودي", "بولو", "جراب موبايل"] as const;

/** One decision of the order: a raised card with its own coloured marker. */
function Question({
  title,
  children,
  aside,
  id,
  icon: Icon,
  hue,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  id?: string;
  icon: LucideIcon;
  hue: string;
}) {
  return (
    <section aria-labelledby={id} className="rounded-[1.6rem] bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="flex items-center gap-2.5 font-display text-[1.12rem] leading-tight font-semibold tracking-[-0.01em]">
          <span className={cn("flex size-9 items-center justify-center rounded-xl", hue)}>
            <Icon className="size-[1.1rem]" aria-hidden="true" />
          </span>
          {title}
        </h2>
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** A selectable option: violet and lifted when chosen, a soft well when not. */
function chip(selected: boolean) {
  return cn(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3.5 text-[0.95rem] font-semibold transition-[background-color,box-shadow,color,transform] duration-200 ease-[var(--ease-out-expo)] active:scale-[0.96]",
    selected
      ? "bg-gradient-to-b from-[#6d47ea] to-violet-deep text-white shadow-[var(--shadow-violet)]"
      : "bg-well text-ink ring-1 ring-hairline hover:ring-violet/40",
  );
}

const PRODUCT_ICONS: Record<string, LucideIcon> = { تيشيرت: Shirt, هودي: Shirt, بولو: Shirt, "جراب موبايل": Smartphone };

/** "YYYY-MM-DD" + n days. */
function addDays(day: string, n: number): string {
  const base = isValidDateString(day) ? dateFromString(day) : dateFromString(todayDateString());
  base.setUTCDate(base.getUTCDate() + n);
  return dateToString(base);
}

export function OrderForm(props: Props) {
  const { mode, initial } = props;
  const [draft, setDraft] = useState<OrderDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  // One key per form visit: a double tap or retried submit cannot create two orders.
  const [requestId] = useState(newRequestId);
  const formRef = useRef<HTMLFormElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
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
    setErrors((e) => ({ ...e, groups: "", [`groups.${index}.operations`]: "", [`groups.${index}.quantity`]: "", [`groups.${index}.sizes`]: "" }));
  };

  /** Product type changes suggest the size breakdown — until the employee flips the switch themselves. */
  function setProductType(value: string) {
    setDraft((d) => {
      const known = PRODUCT_SUGGESTIONS.find((p) => p.name === value.trim());
      return {
        ...d,
        productType: value,
        unit: known ? known.unit : d.unit,
        sizesEnabled: d.sizesTouched ? d.sizesEnabled : isClothingProduct(value),
      };
    });
    setErrors((e) => (e.productType ? { ...e, productType: "" } : e));
  }

  const multiple = draft.groups.length > 1;
  const orderQuantity = parseWholeNumber(draft.quantity);
  const groupSum = draft.groups.reduce((sum, g) => sum + (parseWholeNumber(g.quantity) ?? 0), 0);
  const unitLabel = UNIT_LABELS[draft.unit];

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
      sizesEnabled: draft.sizesEnabled,
      groups: draft.groups.map((g) => ({
        ...(props.mode === "edit" && g.id ? { id: g.id } : {}),
        quantity: g.quantity,
        material: g.material,
        operations: g.operations,
        plain: g.plain,
        notes: g.notes,
        sizes: g.sizes.filter((s) => s.quantity.trim() !== ""),
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
      // Customer sub-fields are shown on the picker; per-size issues on the group's grid.
      let target = key.startsWith("customer.") && key !== "customer.phone" ? "customer" : key;
      const sizeIssue = /^groups\.(\d+)\.sizes\./.exec(key);
      if (sizeIssue) target = `groups.${sizeIssue[1]}.sizes`;
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

  const quantityNow = orderQuantity ?? 0;
  const stepQuantity = (delta: number) => set("quantity", String(Math.max(0, quantityNow + delta)));
  const dueChips = [
    { label: "بكرة", days: 1 },
    { label: "بعد ٣ أيام", days: 3 },
    { label: "بعد أسبوع", days: 7 },
    { label: "بعد أسبوعين", days: 14 },
  ];
  const from = draft.receivedDate || todayDateString();
  const sizedGroups = draft.sizesEnabled ? draft.groups.filter((g) => g.sizes.some((sz) => sz.quantity.trim() !== "")).length : 0;
  // Sizes that don't add up yet: said in the save bar, so nobody is surprised by a refused save.
  const sizeIssue = (() => {
    if (!draft.sizesEnabled) return null;
    for (const [i, g] of draft.groups.entries()) {
      const target = multiple ? parseWholeNumber(g.quantity) : orderQuantity;
      if (!target) continue;
      const sum = g.sizes.reduce((acc, sz) => acc + (parseWholeNumber(sz.quantity) ?? 0), 0);
      if (sum !== target) {
        const where = multiple ? ` في مجموعة ${i + 1}` : "";
        return {
          grid: `g${i}`,
          text: sum < target ? `لسه ${formatNumber(target - sum)} قطعة من غير مقاس${where}` : `المقاسات زيادة ${formatNumber(sum - target)} قطعة${where}`,
        };
      }
    }
    return null;
  })();

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

      <header className="stage animate-settle relative overflow-hidden rounded-[1.75rem] px-5 py-5 text-white shadow-[var(--shadow-violet)]">
        <span aria-hidden="true" className="pointer-events-none absolute -top-14 -end-10 size-40 rounded-full bg-[#ff7aa8]/25 blur-3xl" />
        <h1 className="relative font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">{mode === "create" ? "أوردر جديد" : "تعديل الأوردر"}</h1>
        <p className="relative mt-1 text-[0.92rem] text-white/75">
          {mode === "create" ? "كل الأوردر في صفحة واحدة، واللي مش ضروري متطوي." : (props.mode === "edit" && props.orderLabel) || "عدّل اللي محتاجه واحفظ."}
        </p>
      </header>

      <Question title="مين العميل؟" id="q-customer" icon={User} hue="bg-violet-soft text-violet">
        <CustomerPicker
          value={draft.customer}
          onChange={(customer) => {
            set("customer", customer);
            setErrors((e) => ({ ...e, customer: "", "customer.phone": "" }));
          }}
          error={errors.customer}
          phoneError={errors["customer.phone"]}
        />
        <Field label="اسم الأوردر" htmlFor="title" error={errors.title} hint="اسم قصير يفكّرك بيه في القايمة">
          <Input
            id="title"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="مثال: تيشيرتات محمود"
            aria-invalid={errors.title ? true : undefined}
          />
        </Field>
      </Question>

      <Question title="بنعمل إيه؟" id="q-product" icon={Package} hue="bg-blue-soft text-blue-ink">
        <div>
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="أنواع شائعة">
            {PRODUCT_TILES.map((name) => {
              const selected = draft.productType.trim() === name;
              const Icon = PRODUCT_ICONS[name] ?? Package;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setProductType(name)}
                  className={cn(chip(selected), "relative h-[5.25rem] flex-col gap-1.5 px-1 text-[0.8rem] leading-tight")}
                >
                  {selected && (
                    <span className="absolute top-1.5 end-1.5 flex size-4 items-center justify-center rounded-full bg-white text-violet">
                      <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />
                    </span>
                  )}
                  <Icon className={cn("size-6", !selected && "text-violet")} strokeWidth={1.8} aria-hidden="true" />
                  {name}
                </button>
              );
            })}
          </div>
          <Input
            ref={productInputRef}
            id="productType"
            list="product-suggestions"
            value={draft.productType}
            onChange={(e) => setProductType(e.target.value)}
            placeholder="أو اكتب نوع تاني: كاب، شنطة، قماش…"
            aria-label="نوع المنتج"
            className="mt-3"
            aria-invalid={errors.productType ? true : undefined}
          />
          {errors.productType && <p className="mt-1.5 text-sm text-red">{errors.productType}</p>}
        </div>
        <Field label="الخامة" htmlFor="material" error={errors.material}>
          <Input
            id="material"
            list="material-suggestions"
            value={draft.material}
            onChange={(e) => set("material", e.target.value)}
            placeholder="مثال: قطن 100%"
            aria-invalid={errors.material ? true : undefined}
          />
        </Field>
      </Question>

      <Question title="كام قطعة؟" id="q-quantity" icon={Layers} hue="bg-teal-soft text-teal-ink">
        <div data-error={errors.quantity ? "true" : undefined}>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => stepQuantity(1)}
              aria-label="زوّد قطعة"
              className="flex w-14 shrink-0 items-center justify-center rounded-2xl bg-well text-violet ring-1 ring-hairline transition-transform active:scale-90"
            >
              <Plus className="size-5" aria-hidden="true" />
            </button>
            <label htmlFor="quantity" className="sr-only">
              الكمية المطلوبة
            </label>
            <Input
              id="quantity"
              inputMode="numeric"
              value={draft.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              placeholder="0"
              className="tabular h-16 min-w-0 flex-1 rounded-2xl text-center font-display text-[2rem] font-semibold tracking-[-0.02em] placeholder:text-ink/25"
              aria-invalid={errors.quantity ? true : undefined}
            />
            <button
              type="button"
              onClick={() => stepQuantity(-1)}
              aria-label="قلّل قطعة"
              className="flex w-14 shrink-0 items-center justify-center rounded-2xl bg-well text-violet ring-1 ring-hairline transition-transform active:scale-90"
            >
              <Minus className="size-5" aria-hidden="true" />
            </button>
          </div>
          {errors.quantity && <p className="mt-1.5 text-sm text-red" role="alert">{errors.quantity}</p>}
        </div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="unit" className="text-sm font-semibold">
            الوحدة
          </label>
          <NativeSelect id="unit" value={draft.unit} onChange={(e) => set("unit", e.target.value as QuantityUnit)} className="h-11 w-36">
            {QUANTITY_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl bg-well px-3.5 py-2">
          <span>
            <span className="block font-semibold">تقسيم بالمقاسات</span>
            <span className="block text-xs text-graphite">للملابس: كام قطعة من كل مقاس</span>
          </span>
          <span className="relative inline-flex">
            <input
              type="checkbox"
              role="switch"
              checked={draft.sizesEnabled}
              onChange={(e) => setDraft((d) => ({ ...d, sizesEnabled: e.target.checked, sizesTouched: true }))}
              className="peer sr-only"
            />
            <span className="h-7 w-12 rounded-full bg-[#d8d2e6] transition-colors peer-checked:bg-violet peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet" />
            <span className="absolute top-1 start-1 size-5 rounded-full bg-white shadow-[0_1px_2px_rgb(23_21_28/0.3)] transition-transform duration-200 ease-[var(--ease-out-expo)] peer-checked:-translate-x-5" />
          </span>
        </label>

        {draft.sizesEnabled && !multiple && (
          <SizeGrid
            idPrefix="g0"
            sizes={draft.groups[0]!.sizes}
            target={orderQuantity}
            unitLabel={unitLabel}
            error={errors["groups.0.sizes"]}
            onChange={(sizes) => setGroup(0, { sizes })}
          />
        )}
      </Question>

      <Question title="الشغل المطلوب" id="q-work" icon={Printer} hue="bg-rose-soft text-rose-ink">
        {!multiple && <p className="-mt-2 text-sm text-graphite">ينفع أكتر من نوع على نفس القطعة، والقطعة بتتحسب مرة واحدة.</p>}

        {draft.groups.map((group, index) => (
          <div key={group.key} className={cn(multiple && "space-y-3 rounded-2xl bg-well p-3.5")}>
            {multiple && (
              <div className="flex items-center justify-between">
                <h3 className="font-display text-[1.05rem] font-semibold">
                  مجموعة <span className="tabular text-violet">{index + 1}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, groups: d.groups.filter((_, i) => i !== index) }))}
                  className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-red hover:bg-red-soft"
                  aria-label={`حذف مجموعة ${index + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  حذف
                </button>
              </div>
            )}

            {multiple && (
              <div className="grid grid-cols-[7rem_1fr] gap-3">
                <Field label="الكمية" htmlFor={`g${index}-qty`} error={errors[`groups.${index}.quantity`]}>
                  <Input
                    id={`g${index}-qty`}
                    inputMode="numeric"
                    value={group.quantity}
                    onChange={(e) => setGroup(index, { quantity: e.target.value })}
                    className="tabular text-center font-display text-lg font-semibold"
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

            <OperationPicker group={group} error={errors[`groups.${index}.operations`]} onChange={(patch) => setGroup(index, patch)} />

            {multiple && draft.sizesEnabled && (
              <SizeGrid
                idPrefix={`g${index}`}
                sizes={group.sizes}
                target={parseWholeNumber(group.quantity)}
                unitLabel={unitLabel}
                error={errors[`groups.${index}.sizes`]}
                onChange={(sizes) => setGroup(index, { sizes })}
              />
            )}

            {multiple && (
              <Field label="ملاحظات المجموعة" htmlFor={`g${index}-notes`} optional>
                <Input id={`g${index}-notes`} value={group.notes} onChange={(e) => setGroup(index, { notes: e.target.value })} placeholder="مثال: لوجو على الضهر" />
              </Field>
            )}
          </div>
        ))}

        {multiple && (
          <p
            data-error={errors.groups ? "true" : undefined}
            className={cn("text-sm font-semibold", orderQuantity !== null && groupSum === orderQuantity ? "text-success-ink" : "text-warning-ink")}
          >
            المتوزّع على المجموعات <span className="tabular">{formatNumber(groupSum)}</span> من <span className="tabular">{orderQuantity !== null ? formatNumber(orderQuantity) : "—"}</span>
            {orderQuantity !== null && groupSum !== orderQuantity && (
              <span> — {groupSum < orderQuantity ? `فاضل ${formatNumber(orderQuantity - groupSum)}` : `زيادة ${formatNumber(groupSum - orderQuantity)}`}</span>
            )}
            {errors.groups && <span className="mt-1 block text-red">{errors.groups}</span>}
          </p>
        )}

        {draft.groups.length < MAX_ORDER_GROUPS && (
          <button
            type="button"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#d9d2ea] text-[0.95rem] font-semibold text-violet transition-colors hover:border-violet/50 hover:bg-violet-soft/40"
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
          </button>
        )}
        {!multiple && <p className="text-xs text-graphite">لو جزء من الكمية شغله مختلف (مثلًا 100 DTF و 50 تطريز) ضيف مجموعة تانية.</p>}
      </Question>

      <Question title="الحساب" id="q-money" icon={Wallet} hue="bg-green-soft text-green-ink">
        <Field
          label="سعر الأوردر كله"
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
            large
          />
        </Field>

        {props.mode === "create" && (
          <div className="grid grid-cols-[1fr_auto] items-start gap-3">
            <Field label="المقدم" htmlFor="advance" error={errors.advance} optional>
              <MoneyInput id="advance" value={draft.advance} onChange={(v) => set("advance", v)} invalid={!!errors.advance} placeholder="0" />
            </Field>
            {money.paidNow !== null && money.paidNow > 0n && (
              <Field label="اتدفع إزاي" htmlFor="advanceMethod">
                <NativeSelect id="advanceMethod" value={draft.advanceMethod} onChange={(e) => set("advanceMethod", e.target.value as PaymentMethod)} className="w-32">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
        )}

        <dl className="rounded-2xl bg-ink px-4 py-2 text-white">
          {props.mode === "edit" && (
            <div className="flex items-baseline gap-2 py-1.5">
              <dt className="text-white/65">المدفوع لحد دلوقتي</dt>
              <span className="flex-1" aria-hidden="true" />
              <dd className="tabular font-display font-medium">{formatMoney(toCents(props.paid))}</dd>
            </div>
          )}
          <div className="flex items-baseline gap-2 py-1.5">
            <dt className="text-sm text-white/75">المتبقي على العميل</dt>
            <span className="flex-1" aria-hidden="true" />
            <dd
              className={cn("tabular font-display text-2xl font-semibold", money.remaining !== null && money.remaining < 0n ? "text-[#ff8a8a]" : "text-[#7ee2a8]")}
              aria-live="polite"
            >
              {money.remaining !== null ? formatMoney(money.remaining) : "—"}
            </dd>
          </div>
        </dl>
      </Question>

      <Question title="هيتسلم إمتى؟" id="q-date" icon={CalendarDays} hue="bg-amber-soft text-amber-ink">
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="مواعيد سريعة">
          {dueChips.map((c) => {
            const value = addDays(from, c.days);
            return (
              <button key={c.days} type="button" aria-pressed={draft.deliveryDate === value} onClick={() => set("deliveryDate", value)} className={cn(chip(draft.deliveryDate === value), "px-1 text-[0.85rem]")}>
                {c.label}
              </button>
            );
          })}
        </div>
        <Field label="أو اختار اليوم" htmlFor="deliveryDate" error={errors.deliveryDate}>
          <Input
            id="deliveryDate"
            type="date"
            value={draft.deliveryDate}
            min={draft.receivedDate || undefined}
            onChange={(e) => set("deliveryDate", e.target.value)}
            aria-invalid={errors.deliveryDate ? true : undefined}
          />
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

        <details className="group/more rounded-2xl bg-well px-3.5" open={!!(errors.receivedDate || errors.notes || draft.notes)}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
            ملاحظات وتاريخ الاستلام
            <ChevronDown className="size-4 text-graphite transition-transform duration-200 group-open/more:rotate-180" aria-hidden="true" />
          </summary>
          <div className="space-y-4 pt-1 pb-4">
            <Field label="ملاحظات" htmlFor="notes" optional>
              <Textarea id="notes" value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="مثال: طباعة أمامية وخلفية، الألوان، مكان اللوجو…" />
            </Field>
            <Field label="تاريخ استلام الأوردر" htmlFor="receivedDate" error={errors.receivedDate} hint="النهارده، إلا لو الأوردر اتاخد قبل كده">
              <Input id="receivedDate" type="date" value={draft.receivedDate} onChange={(e) => set("receivedDate", e.target.value)} aria-invalid={errors.receivedDate ? true : undefined} />
            </Field>
          </div>
        </details>
      </Question>

      <FormMessage message={message} />

      {/* The save bar: what is about to be saved, and the one button. */}
      <div className="sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4">
        <div className={cn("flex items-center gap-3 rounded-[1.4rem] bg-ink py-2 ps-4 pe-2 text-white shadow-[var(--shadow-lift)] transition-shadow", sizeIssue && "ring-2 ring-[#ffc56b]/70")}>
          <div className="min-w-0 flex-1 leading-tight" aria-live="polite">
            <p className="tabular truncate font-display text-[1.05rem] font-semibold">
              {orderQuantity ? `${formatNumber(orderQuantity)} ${unitLabel}` : "لسه مفيش كمية"}
              {sizedGroups > 0 && <span className="text-sm font-normal text-white/65"> بالمقاسات</span>}
            </p>
            {sizeIssue ? (
              <button
                type="button"
                onClick={() => document.querySelector(`[data-size-grid="${sizeIssue.grid}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="flex max-w-full items-center gap-1 truncate text-start text-xs font-semibold text-[#ffc56b] underline decoration-[#ffc56b]/40 underline-offset-2"
              >
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{sizeIssue.text} — دوس هنا عشان تكمّل</span>
              </button>
            ) : (
              <p className="tabular truncate text-xs text-white/65">{money.total !== null && money.total > 0n ? formatMoney(money.total) : "من غير سعر لسه"}</p>
            )}
          </div>
          <Button type="submit" size="lg" className="h-12 shrink-0 rounded-2xl bg-gradient-to-b from-[#6d47ea] to-violet-deep px-5 font-display text-base" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                جارٍ الحفظ…
              </>
            ) : mode === "create" ? (
              <>
                <Check className="size-5" aria-hidden="true" />
                حفظ الأوردر
              </>
            ) : (
              "حفظ التعديلات"
            )}
          </Button>
        </div>
      </div>
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
  large,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  large?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0"}
        className={cn(
          "tabular pe-3.5 ps-14 text-left font-display font-semibold placeholder:font-normal placeholder:text-ink/25",
          large ? "h-16 text-[1.75rem] tracking-[-0.02em]" : "h-12 text-lg",
        )}
        aria-invalid={invalid ? true : undefined}
        disabled={disabled}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-medium text-graphite">ج.م</span>
    </div>
  );
}

/** Work on the piece: steps combine on the same garment; "none" is exclusive. */
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

  return (
    <div data-error={error ? "true" : undefined}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="نوع الشغل">
        {PRINT_OPERATIONS.map((op) => {
          const selected = group.operations.includes(op);
          return (
            <button key={op} type="button" role="checkbox" aria-checked={selected} onClick={() => toggle(op)} className={chip(selected)}>
              {OPERATION_LABELS[op]}
            </button>
          );
        })}
        <button
          type="button"
          role="checkbox"
          aria-checked={group.plain}
          onClick={() => onChange((latest) => ({ plain: !latest.plain, operations: [] }))}
          className={cn(chip(group.plain), "font-medium")}
        >
          {NO_OPERATION_LABEL}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
