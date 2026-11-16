"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarDays, Check, ChevronDown, Layers, Loader2, Package, Plus, Shirt, Smartphone, TriangleAlert, User, Wallet, type LucideIcon } from "lucide-react";
import { createOrderAction, updateOrderAction } from "@/app/(app)/orders/actions";
import { Field, FormMessage, NativeSelect, Textarea } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrderStatus, PaymentMethod, QuantityUnit } from "@/generated/prisma/enums";
import { formatMoney, parseMoney, toCents } from "@/lib/money";
import { formatNumber, parseWholeNumber } from "@/lib/numbers";
import { MATERIAL_SUGGESTIONS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PRODUCT_SUGGESTIONS, QUANTITY_UNITS, UNIT_LABELS } from "@/lib/orders/labels";
import { isClothingProduct } from "@/lib/orders/sizes";
import { dateFromString, dateToString, isValidDateString, todayDateString } from "@/lib/dates";
import { newRequestId } from "@/lib/request-id";
import { cn } from "@/lib/utils";
import { createOrderSchema, MAX_ORDER_GROUPS, updateOrderSchema } from "@/lib/validations/order";
import { CustomerPicker } from "./customer-picker";
import { customPlacementsOf, newGroupDraft, type GroupDraft, type OrderDraft } from "./order-draft";
import { chip, MoneyInput } from "./order-form-parts";
import { ItemCard, itemLineTotal } from "./order-items";

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
      /** Agreed total when the edit screen opened (decimal string). */
      originalTotal: string;
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
    <section aria-labelledby={id} className="rounded-2xl bg-surface p-4 border border-line sm:p-5">
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
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "groups" && k !== "totalPrice" && !k.startsWith(`groups.${index}.`))));
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

  const priced = draft.pricing === "items";
  const itemsCount = draft.groups.length;
  const pieces = draft.groups.reduce((sum, g) => sum + (parseWholeNumber(g.quantity) ?? 0), 0);
  const unitLabel = UNIT_LABELS[draft.unit];
  const legacyTotal = props.mode === "edit" ? toCents(props.originalTotal) : null;

  const money = useMemo(() => {
    // Item pricing: Σ quantity × unit price (the server computes the same and keeps its own).
    let total: bigint | null = null;
    if (priced) {
      total = 0n;
      for (const g of draft.groups) {
        const line = itemLineTotal(g);
        if (line === null) {
          total = null;
          break;
        }
        total += line;
      }
    } else {
      total = parseMoney(draft.totalPrice);
    }
    const already = props.mode === "edit" ? toCents(props.paid) : 0n;
    const advance = mode === "create" ? (draft.advance.trim() === "" ? 0n : parseMoney(draft.advance)) : 0n;
    const paidNow = advance === null ? null : already + advance;
    return { total, paidNow, remaining: total !== null && paidNow !== null ? total - paidNow : null };
  }, [draft.groups, draft.totalPrice, draft.advance, priced, mode, props]);

  // Converting an order-total order to item pricing with a different sum: an explicit price correction.
  const converting = props.mode === "edit" && props.initial.pricing === "order" && priced;
  const conversionChangesPrice = converting && money.total !== null && legacyTotal !== null && money.total !== legacyTotal;

  function buildPayload() {
    const customer = draft.customer
      ? draft.customer.mode === "existing"
        ? { mode: "existing" as const, id: draft.customer.id }
        : { mode: "new" as const, name: draft.customer.name, phone: draft.customer.phone }
      : undefined;
    const common = {
      pricing: draft.pricing,
      customer: customer as NonNullable<typeof customer>,
      title: draft.title,
      productType: draft.productType,
      material: draft.material,
      unit: draft.unit,
      sizesEnabled: draft.sizesEnabled,
      groups: draft.groups.map((g) => ({
        ...(props.mode === "edit" && g.id ? { id: g.id } : {}),
        name: g.name,
        quantity: g.quantity,
        material: g.material,
        ...(priced ? { unitPrice: g.unitPrice } : {}),
        pressesPerUnit: g.useDesigns ? undefined : g.pressesPerUnit,
        operations: g.useDesigns ? [] : g.operations,
        plain: g.useDesigns ? g.designs.length === 0 : g.plain,
        designs: g.useDesigns
          ? g.designs.map((d) => ({
              ...(props.mode === "edit" && d.id ? { id: d.id } : {}),
              name: d.name,
              operation: d.operation ?? "",
              placements: d.placements,
              customPlacements: customPlacementsOf(d),
              quantity: d.quantity,
              pressesPerUnit: d.pressesPerUnit,
              notes: d.notes,
            }))
          : [],
        notes: g.notes,
        sizes: g.sizes.filter((s) => s.quantity.trim() !== ""),
      })),
      ...(priced ? {} : { totalPrice: draft.totalPrice }),
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
          confirmPriceChange: draft.confirmPriceChange,
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

    if (conversionChangesPrice && !draft.confirmPriceChange) {
      showErrors({ confirmPriceChange: ["أكّد تعديل سعر الأوردر الأول"] }, "مجموع أسعار البنود مختلف عن السعر المتفق عليه.");
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

  const dueChips = [
    { label: "بكرة", days: 1 },
    { label: "بعد ٣ أيام", days: 3 },
    { label: "بعد أسبوع", days: 7 },
    { label: "بعد أسبوعين", days: 14 },
  ];
  const from = draft.receivedDate || todayDateString();
  // Sizes that don't add up yet: said in the save bar, so nobody is surprised by a refused save.
  const sizeIssue = (() => {
    if (!draft.sizesEnabled) return null;
    for (const [i, g] of draft.groups.entries()) {
      const target = parseWholeNumber(g.quantity);
      if (!target) continue;
      const sum = g.sizes.reduce((acc, sz) => acc + (parseWholeNumber(sz.quantity) ?? 0), 0);
      if (sum !== target) {
        const where = itemsCount > 1 ? ` في البند ${i + 1}` : "";
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

      <header className="stage animate-settle relative overflow-hidden rounded-2xl px-5 py-5 text-on-panel">
        <h1 className="relative font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">{mode === "create" ? "أوردر جديد" : "تعديل الأوردر"}</h1>
        <p className="relative mt-1 text-[0.92rem] text-on-panel-muted">
          {mode === "create" ? "كل الأوردر في صفحة واحدة، واللي مش ضروري متطوي." : (props.mode === "edit" && props.orderLabel) || "عدّل اللي محتاجه واحفظ."}
        </p>
      </header>

      <Question title="مين العميل؟" id="q-customer" icon={User} hue="bg-brand-soft text-brand-ink">
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

      <Question title="بنعمل إيه؟" id="q-product" icon={Package} hue="bg-brand-soft text-brand-ink">
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
                    <span className="absolute top-1.5 end-1.5 flex size-4 items-center justify-center rounded-full bg-surface text-brand">
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
        <Field label="الخامة" htmlFor="material" error={errors.material} hint="لكل البنود، إلا لو اتغيرت جوه البند">
          <Input
            id="material"
            list="material-suggestions"
            value={draft.material}
            onChange={(e) => set("material", e.target.value)}
            placeholder="مثال: قطن 100%"
            aria-invalid={errors.material ? true : undefined}
          />
        </Field>
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
            <span className="block text-xs text-graphite">للملابس: كام قطعة من كل مقاس في كل بند</span>
          </span>
          <span className="relative inline-flex">
            <input
              type="checkbox"
              role="switch"
              checked={draft.sizesEnabled}
              onChange={(e) => setDraft((d) => ({ ...d, sizesEnabled: e.target.checked, sizesTouched: true }))}
              className="peer sr-only"
            />
            <span className="h-7 w-12 rounded-full bg-line-strong transition-colors peer-checked:bg-brand-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet" />
            <span className="absolute top-1 start-1 size-5 rounded-full bg-on-panel transition-transform duration-200 ease-[var(--ease-out-expo)] peer-checked:-translate-x-5" />
          </span>
        </label>
      </Question>

      <Question
        title="البنود"
        id="q-items"
        icon={Layers}
        hue="bg-brand-soft text-brand-ink"
        aside={<span className="tabular text-sm text-graphite">{formatNumber(itemsCount)} بند · {formatNumber(pieces)} {unitLabel}</span>}
      >
        <p className="-mt-2 text-sm text-graphite">كل بند ليه اسمه وكميته وسعره. لو البند عليه أكتر من رسمة (صدر وظهر مثلًا) ضيفها جوه نفس البند.</p>
        {draft.groups.map((group, index) => (
          <ItemCard
            key={group.key}
            index={index}
            count={itemsCount}
            group={group}
            priced={priced}
            priceLocked={props.mode === "edit" && !props.canEditPrice}
            sizesEnabled={draft.sizesEnabled}
            unitLabel={unitLabel}
            defaultMaterial={draft.material}
            errors={errors}
            onChange={(patch) => setGroup(index, patch)}
            onRemove={() => setDraft((d) => ({ ...d, groups: d.groups.filter((_, i) => i !== index) }))}
          />
        ))}
        {errors.groups && <p className="text-sm text-red" data-error="true">{errors.groups}</p>}
        {draft.groups.length < MAX_ORDER_GROUPS && (
          <button
            type="button"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-[0.95rem] font-semibold text-brand transition-colors hover:bg-brand-soft/40"
            onClick={() => setDraft((d) => ({ ...d, groups: [...d.groups, newGroupDraft()] }))}
          >
            <Plus className="size-5" aria-hidden="true" />
            إضافة بند جديد
          </button>
        )}
      </Question>

      <Question title="الحساب" id="q-money" icon={Wallet} hue="bg-brand-soft text-brand-ink">
        {priced ? (
          <div data-error={errors.totalPrice ? "true" : undefined}>
            <ul className="divide-y divide-line rounded-2xl bg-well px-3.5 text-sm">
              {draft.groups.map((g, i) => {
                const line = itemLineTotal(g);
                return (
                  <li key={g.key} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      {g.name.trim() || `البند ${i + 1}`} <span className="tabular text-graphite">{g.quantity || "0"} × {g.unitPrice || "0"}</span>
                    </span>
                    <span className="tabular shrink-0 font-semibold">{line !== null ? formatMoney(line) : "—"}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 flex items-baseline justify-between px-1">
              <span className="font-semibold">إجمالي الأوردر</span>
              <span className="tabular font-display text-2xl font-semibold" data-testid="order-total" aria-live="polite">
                {money.total !== null ? formatMoney(money.total) : "—"}
              </span>
            </p>
            {errors.totalPrice && <p className="mt-1 text-sm text-red">{errors.totalPrice}</p>}
            {converting && legacyTotal !== null && (
              <div className={cn("mt-3 rounded-2xl p-3 text-sm", conversionChangesPrice ? "bg-warning-soft text-warning-ink" : "bg-well text-graphite")} data-error={errors.confirmPriceChange ? "true" : undefined}>
                <p>السعر المتفق عليه قبل التحويل: <b className="tabular">{formatMoney(legacyTotal)}</b></p>
                {conversionChangesPrice ? (
                  <label className="mt-2 flex items-start gap-2 font-semibold">
                    <input type="checkbox" className="mt-1 size-4" checked={draft.confirmPriceChange} onChange={(e) => set("confirmPriceChange", e.target.checked)} />
                    أكّد تعديل سعر الأوردر من {formatMoney(legacyTotal)} لـ {money.total !== null ? formatMoney(money.total) : "—"} (هيتسجل كتعديل سعر).
                  </label>
                ) : (
                  <p className="mt-1">مجموع البنود = نفس السعر المتفق عليه ✓</p>
                )}
                {errors.confirmPriceChange && <p className="mt-1 text-red">{errors.confirmPriceChange}</p>}
              </div>
            )}
          </div>
        ) : (
          <>
            <Field
              label="سعر الأوردر كله"
              htmlFor="totalPrice"
              error={errors.totalPrice}
              hint={props.mode === "edit" && !props.canEditPrice ? "تعديل السعر للمدير بس" : "أوردر قديم متسعّر بسعر إجمالي واحد"}
            >
              <MoneyInput id="totalPrice" value={draft.totalPrice} onChange={(v) => set("totalPrice", v)} invalid={!!errors.totalPrice} disabled={props.mode === "edit" && !props.canEditPrice} large />
            </Field>
            {props.mode === "edit" && props.canEditPrice && (
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, pricing: "items", confirmPriceChange: false }))}
                className="flex h-11 w-full items-center justify-center rounded-xl border border-line text-sm font-semibold text-brand hover:bg-brand-soft/40"
              >
                تحويل لتسعير بالبند (تكتب سعر القطعة لكل بند)
              </button>
            )}
          </>
        )}
        {converting && (
          <button type="button" onClick={() => setDraft((d) => ({ ...d, pricing: "order", confirmPriceChange: false }))} className="text-sm font-semibold text-graphite underline">
            رجوع للسعر الإجمالي الواحد
          </button>
        )}

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

        <dl className="rounded-2xl bg-panel px-4 py-2 text-on-panel">
          {props.mode === "edit" && (
            <div className="flex items-baseline gap-2 py-1.5">
              <dt className="text-on-panel-muted">المدفوع لحد دلوقتي</dt>
              <span className="flex-1" aria-hidden="true" />
              <dd className="tabular font-display font-medium">{formatMoney(toCents(props.paid))}</dd>
            </div>
          )}
          <div className="flex items-baseline gap-2 py-1.5">
            <dt className="text-sm text-on-panel-muted">المتبقي على العميل</dt>
            <span className="flex-1" aria-hidden="true" />
            <dd className={cn("tabular font-display text-2xl font-semibold", money.remaining !== null && money.remaining < 0n ? "text-panel-danger" : "text-panel-success")} aria-live="polite">
              {money.remaining !== null ? formatMoney(money.remaining) : "—"}
            </dd>
          </div>
        </dl>
      </Question>

      <Question title="هيتسلم إمتى؟" id="q-date" icon={CalendarDays} hue="bg-brand-soft text-brand-ink">
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
        <div className={cn("flex items-center gap-3 rounded-2xl bg-panel py-2 ps-4 pe-2 text-on-panel border border-line transition-shadow", sizeIssue && "ring-2 ring-panel-warning")}>
          <div className="min-w-0 flex-1 leading-tight" aria-live="polite">
            <p className="tabular truncate font-display text-[1.05rem] font-semibold">
              {pieces ? `${formatNumber(pieces)} ${unitLabel}` : "لسه مفيش كمية"}
              <span className="text-sm font-normal text-on-panel-muted"> · {formatNumber(itemsCount)} بند</span>
            </p>
            {sizeIssue ? (
              <button
                type="button"
                onClick={() => document.querySelector(`[data-size-grid="${sizeIssue.grid}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="flex max-w-full items-center gap-1 truncate text-start text-xs font-semibold text-panel-warning underline decoration-panel-warning/40 underline-offset-2"
              >
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{sizeIssue.text} — دوس هنا عشان تكمّل</span>
              </button>
            ) : (
              <p className="tabular truncate text-xs text-on-panel-muted">{money.total !== null && money.total > 0n ? formatMoney(money.total) : "من غير سعر لسه"}</p>
            )}
          </div>
          <Button type="submit" size="lg" className="h-12 shrink-0 rounded-2xl bg-brand-solid px-5 font-display text-base" disabled={pending}>
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

