"use client";

import { ArrowDown, ArrowUp, ChevronDown, Layers, Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { formatMoney, parseMoney } from "@/lib/money";
import { formatNumber, parseWholeNumber } from "@/lib/numbers";
import { MAX_CUSTOM_PLACEMENTS, OPERATION_LABELS, OTHER_PLACEMENT_LABEL, PLACEMENT_LABELS, PLACEMENTS, PRINT_OPERATIONS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { MAX_DESIGNS_PER_ITEM } from "@/lib/validations/order";
import { newDesignDraft, type DesignDraft, type GroupDraft } from "./order-draft";
import { chip, MoneyInput, OperationPicker } from "./order-form-parts";
import { SizeGrid } from "./size-grid";

type Errors = Record<string, string>;

/** Line total of one item in piasters, or null while quantity/price are incomplete. */
export function itemLineTotal(g: GroupDraft): bigint | null {
  const q = parseWholeNumber(g.quantity);
  const p = g.unitPrice.trim() === "" ? null : parseMoney(g.unitPrice);
  return q === null || p === null ? null : BigInt(q) * p;
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
  errors,
  onChange,
  onRemove,
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
  errors: Errors;
  onChange: (patch: Partial<GroupDraft> | ((g: GroupDraft) => Partial<GroupDraft>)) => void;
  onRemove: () => void;
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
    <article className="space-y-3 rounded-2xl border border-line bg-surface p-3.5 sm:p-4" aria-labelledby={`item-${index}-title`} data-item={index}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`item-${index}-title`} className="font-display text-[1.05rem] font-semibold">
          البند <span className="tabular text-brand">{index + 1}</span>
        </h3>
        {count > 1 && (
          <button type="button" onClick={onRemove} className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-red hover:bg-red-soft" aria-label={`حذف البند ${index + 1}`}>
            <Trash2 className="size-4" aria-hidden="true" />
            حذف
          </button>
        )}
      </div>

      <Field label="اسم البند / الرسمة" htmlFor={`g${index}-name`} error={e("name")} optional={!priced}>
        <Input id={`g${index}-name`} value={group.name} onChange={(ev) => onChange({ name: ev.target.value })} placeholder="مثال: تيشيرتات AUC" aria-invalid={e("name") ? true : undefined} />
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
        <p className="flex items-baseline justify-between rounded-xl bg-well px-3 py-2 text-sm">
          <span className="text-graphite">إجمالي البند</span>
          <span className="tabular font-display text-base font-semibold" data-testid={`line-total-${index}`}>
            {lineTotal !== null ? formatMoney(lineTotal) : "—"}
          </span>
        </p>
      )}

      {sizesEnabled && (
        <SizeGrid idPrefix={`g${index}`} sizes={group.sizes} target={qty} unitLabel={unitLabel} error={e("sizes")} onChange={(sizes) => onChange({ sizes })} />
      )}

      {group.useDesigns ? (
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
          {group.designs.length === 0 && <p className="rounded-xl bg-well p-3 text-sm text-graphite">من غير طباعة أو تطريز.</p>}
          {group.designs.length < MAX_DESIGNS_PER_ITEM && (
            <button
              type="button"
              onClick={() => onChange((g) => ({ designs: [...g.designs, newDesignDraft()], plain: false }))}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-sm font-semibold text-brand hover:bg-brand-soft/40"
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

      <details className="group/more rounded-xl bg-well px-3" open={!!(e("pressesPerUnit") || group.notes || (count > 1 && group.material))}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          الخامة {group.useDesigns ? "" : "والكبسات "}والملاحظات
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

  return (
    <div className="space-y-3 rounded-xl bg-well p-3" data-design={id}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-sm font-semibold">
          رسمة <span className="tabular text-brand">{index + 1}</span>
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

      <Field label="اسم الرسمة" htmlFor={`${id}-name`} optional>
        <Input id={`${id}-name`} value={design.name} onChange={(ev) => onChange({ name: ev.target.value })} placeholder="مثال: لوجو AUC" />
      </Field>

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
  );
}
