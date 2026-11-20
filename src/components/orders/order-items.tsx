"use client";

import { ArrowDown, ArrowUp, ChevronDown, Layers, PackageCheck, Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { formatMoney, parseMoney } from "@/lib/money";
import { formatNumber, parseWholeNumber } from "@/lib/numbers";
import { MAX_CUSTOM_PLACEMENTS, OPERATION_LABELS, OTHER_PLACEMENT_LABEL, PLACEMENT_LABELS, PLACEMENTS, PRINT_OPERATIONS, READY_MADE_PRESETS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { MAX_DESIGNS_PER_ITEM } from "@/lib/validations/order";
import { checkLinear, cmToMm, isFractionalUnit, linearLineCents, WORK_KIND_CONFIG } from "@/lib/orders/work-kinds";
import { parseQuantity, usageTotalCents } from "@/lib/finance/usage";
import { newDesignDraft, type DesignDraft, type GroupDraft } from "./order-draft";
import { spansDepartments, type DepartmentOption } from "@/lib/departments/suggest";
import { chip, MoneyInput, OperationPicker } from "./order-form-parts";
import { SizeGrid } from "./size-grid";

type Errors = Record<string, string>;

/** Linear-meter measurement of a draft line (null for unit-priced lines). Same rules as the server. */
export function draftLinear(g: GroupDraft) {
  if (!g.workKind || WORK_KIND_CONFIG[g.workKind].pricing !== "LINEAR_METER") return null;
  return checkLinear({
    fileWidthMm: cmToMm(g.fileWidthCm) ?? 0,
    fileLengthMm: cmToMm(g.fileLengthCm) ?? 0,
    copies: parseWholeNumber(g.quantity) ?? 0,
    copiesPerRow: g.copiesPerRow.trim() === "" ? 1 : (parseWholeNumber(g.copiesPerRow) ?? 0),
    rollWidthMm: cmToMm(g.rollWidthCm) ?? 0,
  });
}

/** Line total of one item in piasters, or null while quantity/price/measurement are incomplete. */
export function itemLineTotal(g: GroupDraft): bigint | null {
  const p0 = g.unitPrice.trim() === "" ? null : parseMoney(g.unitPrice);
  // Raw materials in a fractional unit (kg, liter, meter): decimal quantity × price.
  if (g.workKind === "RAW_MATERIALS" && isFractionalUnit(g.saleUnit)) {
    const milli = parseQuantity(g.quantity);
    return milli === null || milli <= 0n || p0 === null ? null : usageTotalCents(milli, p0);
  }
  const q = parseWholeNumber(g.quantity);
  const p = p0;
  if (q === null || p === null) return null;
  const linear = draftLinear(g);
  if (linear) return linear.ok ? linearLineCents(linear.billableLengthMm, p) : null;
  return BigInt(q) * p;
}

/**
 * One «بند»: a group of physical pieces with its own name, quantity, unit
 * price and work. Its designs describe the work on those SAME pieces — they
 * never add pieces.
 */
export function ItemCard({
  index,
  count,
  group,
  priced,
  priceLocked,
  sizesEnabled,
  unitLabel,
  defaultMaterial,
  departments = [],
  departmentId = "",
  presets = READY_MADE_PRESETS,
  errors,
  onChange,
  onRemove,
  onReadyPreset,
}: {
  index: number;
  count: number;
  group: GroupDraft;
  /** Show the unit price (item pricing). */
  priced: boolean;
  /** Prices are read-only (staff can't change prices). */
  priceLocked: boolean;
  sizesEnabled: boolean;
  unitLabel: string;
  defaultMaterial: string;
  /** Departments offered (active ones, plus an item's current one). */
  departments?: DepartmentOption[];
  /** The item's department: chosen, or suggested from its work while not chosen. */
  departmentId?: string;
  /** «منتج جاهز» shortcuts (managed by the owner). */
  presets?: readonly string[];
  errors: Errors;
  onChange: (patch: Partial<GroupDraft> | ((g: GroupDraft) => Partial<GroupDraft>)) => void;
  onRemove: () => void;
  /** A ready-made product was picked from the shortcuts (the form may use it as the product type). */
  onReadyPreset?: (name: string) => void;
}) {
  const e = (key: string) => errors[`groups.${index}.${key}`];
  const qty = parseWholeNumber(group.quantity);
  const lineTotal = itemLineTotal(group);
  const setDesign = (d: number, patch: Partial<DesignDraft> | ((x: DesignDraft) => Partial<DesignDraft>)) =>
    onChange((g) => ({ designs: g.designs.map((x, i) => (i === d ? { ...x, ...(typeof patch === "function" ? patch(x) : patch) } : x)) }));
  const moveDesign = (d: number, by: number) =>
    onChange((g) => {
      const list = [...g.designs];
      const [item] = list.splice(d, 1);
      list.splice(d + by, 0, item!);
      return { designs: list };
    });

  return (
    <article className="space-y-3 rounded-2xl bg-well p-3.5 sm:p-4" aria-labelledby={`item-${index}-title`} data-item={index}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`item-${index}-title`} className="flex min-w-0 items-center gap-2 font-display text-[1.05rem] font-semibold">
          <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-solid text-sm text-on-brand" aria-hidden="true">
            {index + 1}
          </span>
          <span className="truncate">{group.name.trim() || `البند ${index + 1}`}</span>
          <span className="sr-only">(البند {index + 1})</span>
        </h3>
        {count > 1 && (
          <button type="button" onClick={onRemove} className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-red hover:bg-red-soft" aria-label={`حذف البند ${index + 1}`}>
            <Trash2 className="size-4" aria-hidden="true" />
            حذف
          </button>
        )}
      </div>

      {/* Older items saved with a work type only (no designs) keep their own picker below. */}
      {group.useDesigns && (
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1 ring-1 ring-line" role="radiogroup" aria-label={`نوع البند ${index + 1}`}>
          <button
            type="button"
            role="radio"
            aria-checked={!group.readyMade}
            onClick={() => onChange((g) => (g.readyMade ? { readyMade: false, plain: false, designs: g.designs.length > 0 ? g.designs : [newDesignDraft()] } : {}))}
            className={cn("flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors", !group.readyMade ? "bg-brand-solid text-white" : "text-graphite hover:text-ink")}
          >
            <Layers className="size-4" aria-hidden="true" />
            طباعة / تطريز
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={group.readyMade}
            onClick={() => onChange({ readyMade: true, plain: true, designs: [] })}
            className={cn("flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors", group.readyMade ? "bg-brand-solid text-white" : "text-graphite hover:text-ink")}
          >
            <PackageCheck className="size-4" aria-hidden="true" />
            منتج جاهز
          </button>
        </div>
      )}

      {group.readyMade && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="منتجات جاهزة">
          {presets.map((name) => {
            const on = group.name.trim() === name;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onChange({ name });
                  onReadyPreset?.(name);
                }}
                className={cn(chip(on), "min-h-10 px-3 text-sm")}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      <Field
        label={group.readyMade ? "اسم المنتج" : "اسم البند / الرسمة"}
        htmlFor={`g${index}-name`}
        error={e("name")}
        optional={!priced}
        hint={group.readyMade ? "اختار من فوق أو اكتب أي منتج تاني" : undefined}
      >
        <Input
          id={`g${index}-name`}
          value={group.name}
          onChange={(ev) => onChange({ name: ev.target.value })}
          placeholder={group.readyMade ? "مثال: تيشيرت أسود قطن" : "مثال: تيشيرتات AUC"}
          aria-invalid={e("name") ? true : undefined}
        />
      </Field>

      <div className={cn("grid gap-3", priced ? "grid-cols-2" : "grid-cols-1")}>
        <Field label={`الكمية (${unitLabel})`} htmlFor={`g${index}-qty`} error={e("quantity")}>
          <Input
            id={`g${index}-qty`}
            inputMode="numeric"
            value={group.quantity}
            onChange={(ev) => onChange({ quantity: ev.target.value })}
            placeholder="0"
            className="tabular text-center font-display text-lg font-semibold"
            aria-invalid={e("quantity") ? true : undefined}
          />
        </Field>
        {priced && (
          <Field label="سعر القطعة" htmlFor={`g${index}-price`} error={e("unitPrice")}>
            <MoneyInput id={`g${index}-price`} value={group.unitPrice} onChange={(v) => onChange({ unitPrice: v })} invalid={!!e("unitPrice")} disabled={priceLocked} />
          </Field>
        )}
      </div>
      {priced && (
        <p className="flex items-baseline justify-between rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-line">
          <span className="text-graphite">إجمالي البند</span>
          <span className="tabular font-display text-base font-semibold" data-testid={`line-total-${index}`}>
            {lineTotal !== null ? formatMoney(lineTotal) : "—"}
          </span>
        </p>
      )}

      {sizesEnabled && (
        <SizeGrid idPrefix={`g${index}`} sizes={group.sizes} target={qty} unitLabel={unitLabel} error={e("sizes")} onChange={(sizes) => onChange({ sizes })} />
      )}

      {departments.length > 0 && (
        <div data-error={e("departmentId") ? "true" : undefined}>
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
            القسم
            {!group.departmentId && departmentId && <span className="text-xs font-normal text-graphite">(مقترح من نوع الشغل — غيّره لو محتاج)</span>}
          </p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`قسم البند ${index + 1}`}>
            {departments.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={departmentId === d.id}
                onClick={() => onChange({ departmentId: d.id })}
                className={cn(chip(departmentId === d.id), "min-h-10 px-3 text-sm")}
              >
                {d.name}
              </button>
            ))}
          </div>
          {e("departmentId") && <p className="mt-1 text-sm text-red">{e("departmentId")}</p>}
          {spansDepartments({ designs: group.useDesigns ? group.designs : [], operations: group.useDesigns ? [] : group.operations }) && (
            <p className="mt-1.5 text-xs text-graphite">البند ده فيه شغل لأكتر من قسم — قيمته كلها بتتحسب للقسم اللي تختاره بس. لو كل قسم ليه سعر، قسّمه لبندين.</p>
          )}
        </div>
      )}

      {group.readyMade ? (
        <p className="rounded-xl bg-surface p-3 text-sm text-graphite ring-1 ring-line">
          منتج جاهز من غير طباعة أو تطريز — مفيش تفاصيل تصنيع. يتعلّم «جاهز» ويتسلّم على طول.
        </p>
      ) : group.useDesigns ? (
        <section aria-label={`رسومات البند ${index + 1}`} className="space-y-2.5">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <Layers className="size-4 text-brand" aria-hidden="true" />
            الرسومات / أماكن الطباعة
          </h4>
          <p className="text-xs text-graphite">كل رسمة على نفس القطع — القطع بتتحسب مرة واحدة مهما كان عدد الرسومات.</p>
          {group.designs.map((d, i) => (
            <DesignCard
              key={d.key}
              itemIndex={index}
              index={i}
              count={group.designs.length}
              design={d}
              itemQuantity={qty}
              errors={errors}
              onChange={(patch) => setDesign(i, patch)}
              onRemove={() => onChange((g) => ({ designs: g.designs.filter((_, x) => x !== i) }))}
              onMove={(by) => moveDesign(i, by)}
            />
          ))}
          {group.designs.length === 0 && <p className="rounded-xl bg-surface p-3 text-sm text-graphite ring-1 ring-line">من غير طباعة أو تطريز.</p>}
          {group.designs.length < MAX_DESIGNS_PER_ITEM && (
            <button
              type="button"
              onClick={() => onChange((g) => ({ designs: [...g.designs, newDesignDraft()], plain: false }))}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong bg-surface/60 text-sm font-semibold text-brand hover:bg-brand-soft/40"
            >
              <Plus className="size-4" aria-hidden="true" />
              إضافة رسمة
            </button>
          )}
          {e("operations") && <p className="text-sm text-red">{e("operations")}</p>}
        </section>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold">الشغل المطلوب</p>
          <OperationPicker group={group} error={e("operations")} onChange={(patch) => onChange(patch)} />
          <p className="text-xs text-graphite">بند قديم مسجّل بنوع الشغل بس (من غير رسومات).</p>
        </div>
      )}

      <details className="group/more rounded-xl bg-surface px-3 ring-1 ring-line" open={!!(e("pressesPerUnit") || group.notes || (count > 1 && group.material))}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          الخامة {group.useDesigns ? "" : "والكبسات "}والملاحظات
          <span className="text-xs font-normal text-graphite">(اختياري)</span>
          <ChevronDown className="size-4 text-graphite transition-transform group-open/more:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-3 pt-1 pb-3">
          <Field label="الخامة" htmlFor={`g${index}-mat`} optional>
            <Input id={`g${index}-mat`} list="material-suggestions" value={group.material} onChange={(ev) => onChange({ material: ev.target.value })} placeholder={defaultMaterial || "نفس خامة الأوردر"} />
          </Field>
          {!group.useDesigns && (
            <Field label="عدد الكبسات لكل قطعة" htmlFor={`g${index}-press`} error={e("pressesPerUnit")} optional hint="للتخطيط بس — مش شغل متسجل">
              <Input id={`g${index}-press`} inputMode="numeric" value={group.pressesPerUnit} onChange={(ev) => onChange({ pressesPerUnit: ev.target.value })} placeholder="مثال: 2" className="tabular" />
            </Field>
          )}
          <Field label="ملاحظات البند" htmlFor={`g${index}-notes`} optional>
            <Input id={`g${index}-notes`} value={group.notes} onChange={(ev) => onChange({ notes: ev.target.value })} placeholder="مثال: الألوان، المقاس الخاص…" />
          </Field>
        </div>
      </details>
    </article>
  );
}

function DesignCard({
  itemIndex,
  index,
  count,
  design,
  itemQuantity,
  errors,
  onChange,
  onRemove,
  onMove,
}: {
  itemIndex: number;
  index: number;
  count: number;
  design: DesignDraft;
  itemQuantity: number | null;
  errors: Errors;
  onChange: (patch: Partial<DesignDraft> | ((d: DesignDraft) => Partial<DesignDraft>)) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
}) {
  const id = `g${itemIndex}-d${index}`;
  const e = (key: string) => errors[`groups.${itemIndex}.designs.${index}.${key}`];
  const pieces = parseWholeNumber(design.quantity) ?? itemQuantity;
  const presses = parseWholeNumber(design.pressesPerUnit);
  const planned = pieces !== null && presses !== null && design.pressesPerUnit.trim() !== "" ? pieces * presses : null;
  // Optional details start folded; they open when something is filled in or needs fixing.
  const detailsOpen = !!(
    design.name ||
    design.placements.length ||
    design.otherOn ||
    design.quantity ||
    design.pressesPerUnit ||
    design.notes ||
    e("quantity") ||
    e("pressesPerUnit") ||
    errors[`groups.${itemIndex}.designs.${index}.customPlacements`]
  );

  return (
    <div className="space-y-3 rounded-xl bg-surface p-3 ring-1 ring-line" data-design={id}>
      <div className="flex items-center gap-1">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold">
          <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-xs text-brand-ink" aria-hidden="true">
            {index + 1}
          </span>
          <span className="truncate">{design.name.trim() || `رسمة ${index + 1}`}</span>
        </p>
        {count > 1 && (
          <>
            <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="flex size-9 items-center justify-center rounded-full text-graphite hover:bg-surface disabled:opacity-30" aria-label="طلّع الرسمة لفوق">
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
            <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className="flex size-9 items-center justify-center rounded-full text-graphite hover:bg-surface disabled:opacity-30" aria-label="نزّل الرسمة لتحت">
              <ArrowDown className="size-4" aria-hidden="true" />
            </button>
          </>
        )}
        <button type="button" onClick={onRemove} className="flex size-9 items-center justify-center rounded-full text-red hover:bg-red-soft" aria-label={`حذف رسمة ${index + 1}`}>
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div data-error={e("operation") ? "true" : undefined}>
        <p className="mb-1.5 text-sm font-medium">نوع الشغل</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="نوع الشغل">
          {PRINT_OPERATIONS.map((op) => (
            <button key={op} type="button" role="radio" aria-checked={design.operation === op} onClick={() => onChange({ operation: op })} className={cn(chip(design.operation === op), "min-h-11 px-3 text-sm")}>
              {OPERATION_LABELS[op]}
            </button>
          ))}
        </div>
        {e("operation") && <p className="mt-1 text-sm text-red">{e("operation")}</p>}
      </div>

      <details className="group/spec rounded-xl bg-well px-3" open={detailsOpen}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          تفاصيل الرسمة
          <span className="text-xs font-normal text-graphite">(اختياري: الاسم، المكان، العدد، الكبسات)</span>
          <ChevronDown className="ms-auto size-4 shrink-0 text-graphite transition-transform group-open/spec:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-3 pt-1 pb-3">
      <Field label="اسم الرسمة" htmlFor={`${id}-name`} optional>
        <Input id={`${id}-name`} value={design.name} onChange={(ev) => onChange({ name: ev.target.value })} placeholder="مثال: لوجو AUC" />
      </Field>

      <div>
        <p className="mb-1.5 text-sm font-medium">مكان الرسمة</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="مكان الرسمة">
          {PLACEMENTS.map((p) => {
            const on = design.placements.includes(p);
            return (
              <button
                key={p}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onChange((d) => ({ placements: d.placements.includes(p) ? d.placements.filter((x) => x !== p) : [...d.placements, p] }))}
                className={cn(chip(on), "min-h-11 px-3 text-sm")}
              >
                {PLACEMENT_LABELS[p]}
              </button>
            );
          })}
          <button type="button" role="checkbox" aria-checked={design.otherOn} onClick={() => onChange((d) => ({ otherOn: !d.otherOn }))} className={cn(chip(design.otherOn), "min-h-11 px-3 text-sm")}>
            {OTHER_PLACEMENT_LABEL}
          </button>
        </div>
        {design.otherOn && (
          <Input
            aria-label="مكان تاني"
            value={design.otherText}
            onChange={(ev) => onChange({ otherText: ev.target.value })}
            placeholder={`مثال: تحت الرقبة، على الجيب (لحد ${MAX_CUSTOM_PLACEMENTS} أماكن)`}
            className="mt-2"
          />
        )}
        {errors[`groups.${itemIndex}.designs.${index}.customPlacements`] && <p className="mt-1 text-sm text-red">{errors[`groups.${itemIndex}.designs.${index}.customPlacements`]}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="عدد القطع" htmlFor={`${id}-qty`} error={e("quantity")} hint={design.quantity.trim() === "" && itemQuantity ? `كل القطع (${formatNumber(itemQuantity)})` : undefined}>
          <Input
            id={`${id}-qty`}
            inputMode="numeric"
            value={design.quantity}
            onChange={(ev) => onChange({ quantity: ev.target.value })}
            placeholder={itemQuantity ? String(itemQuantity) : "كل القطع"}
            className="tabular text-center"
            aria-invalid={e("quantity") ? true : undefined}
          />
        </Field>
        <Field label="عدد الكبسات لكل قطعة" htmlFor={`${id}-press`} error={e("pressesPerUnit")} optional>
          <Input id={`${id}-press`} inputMode="numeric" value={design.pressesPerUnit} onChange={(ev) => onChange({ pressesPerUnit: ev.target.value })} placeholder="—" className="tabular text-center" />
        </Field>
      </div>
      {planned !== null && <p className="text-xs text-graphite">مخطط: <span className="tabular font-semibold text-ink">{formatNumber(planned)}</span> كبسة (تخطيط بس، مش شغل متسجل)</p>}

      <Field label="ملاحظات" htmlFor={`${id}-notes`} optional>
        <Input id={`${id}-notes`} value={design.notes} onChange={(ev) => onChange({ notes: ev.target.value })} placeholder="مثال: الألوان، المقاس…" />
      </Field>
        </div>
      </details>
    </div>
  );
}
