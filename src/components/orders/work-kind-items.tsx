"use client";

import { Plus, Ruler, Trash2 } from "lucide-react";
import { Field, NativeSelect } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import type { DepartmentOption } from "@/lib/departments/suggest";
import { formatMeters, isFractionalUnit, maxCopiesPerRow, cmToMm, OTHER_VARIANT, SALE_UNITS, variantLabel, WORK_KIND_CONFIG, type WorkKind } from "@/lib/orders/work-kinds";
import { cn } from "@/lib/utils";
import { newWorkLine, type GroupDraft } from "./order-draft";
import { chip, MoneyInput } from "./order-form-parts";
import { draftLinear, itemLineTotal } from "./order-items";

type Errors = Record<string, string>;

/**
 * The lines of a work-kind order (ورق DTF، فينيل، طباعة/تطريز/كبس للغير، خامات).
 * Everything that differs per kind comes from WORK_KIND_CONFIG. Each selected
 * material / method is its own priced line, so nothing is merged.
 */
export function WorkKindItems({
  kind,
  groups,
  errors,
  priceLocked,
  departments,
  departmentOf,
  defaultRollWidthCm,
  onChange,
  onGroups,
}: {
  kind: WorkKind;
  groups: GroupDraft[];
  errors: Errors;
  priceLocked: boolean;
  departments: DepartmentOption[];
  departmentOf: (g: GroupDraft) => string;
  /** Owner-configured roll width for this kind (cm); "" = typed per line. */
  defaultRollWidthCm: string;
  onChange: (index: number, patch: Partial<GroupDraft>) => void;
  onGroups: (update: (groups: GroupDraft[]) => GroupDraft[]) => void;
}) {
  const cfg = WORK_KIND_CONFIG[kind];
  const linearKind = cfg.pricing === "LINEAR_METER";
  const newLine = (variant = "") => newWorkLine(kind, { variant, rollWidthCm: linearKind ? defaultRollWidthCm : "" });
  const used = new Set(groups.map((g) => g.variant));

  return (
    <div className="space-y-3">
      {cfg.variants && (
        <div data-error={errors.groups ? "true" : undefined}>
          <p className="mb-1.5 text-sm font-semibold">
            {cfg.variants.title}
            <span className="ms-1 text-xs font-normal text-graphite">(اختار واحد أو أكتر — كل اختيار ليه سطر وسعر لوحده)</span>
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={cfg.variants.title}>
            {cfg.variants.options.map((o) => {
              const on = used.has(o.code);
              return (
                <button
                  key={o.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onGroups((list) => (on && o.code !== OTHER_VARIANT ? list.filter((g) => g.variant !== o.code) : [...list.filter((g) => g.variant !== "" || list.length > 1), newLine(o.code)]))
                  }
                  className={cn(chip(on), "min-h-11 px-3.5 text-sm")}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {groups.map((g, i) => (
        <WorkLine
          key={g.key}
          index={i}
          count={groups.length}
          kind={kind}
          group={g}
          errors={errors}
          priceLocked={priceLocked}
          departments={departments}
          departmentId={departmentOf(g)}
          onChange={(patch) => onChange(i, patch)}
          onRemove={() => onGroups((list) => list.filter((_, j) => j !== i))}
        />
      ))}

      <button
        type="button"
        onClick={() => onGroups((list) => [...list, newLine(cfg.variants?.options[0]?.code ?? "")])}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-[0.95rem] font-semibold text-brand hover:bg-brand-soft/40"
      >
        <Plus className="size-5" aria-hidden="true" />
        {cfg.variants ? "سطر تاني" : "إضافة سطر"}
      </button>
    </div>
  );
}

function WorkLine({
  index,
  count,
  kind,
  group,
  errors,
  priceLocked,
  departments,
  departmentId,
  onChange,
  onRemove,
}: {
  index: number;
  count: number;
  kind: WorkKind;
  group: GroupDraft;
  errors: Errors;
  priceLocked: boolean;
  departments: DepartmentOption[];
  departmentId: string;
  onChange: (patch: Partial<GroupDraft>) => void;
  onRemove: () => void;
}) {
  const cfg = WORK_KIND_CONFIG[kind];
  const e = (key: string) => errors[`groups.${index}.${key}`];
  const id = (key: string) => `g${index}-${key}`;
  const linearKind = cfg.pricing === "LINEAR_METER";
  const linear = draftLinear(group);
  const total = itemLineTotal(group);
  const fileWidthMm = cmToMm(group.fileWidthCm);
  const rollMm = cmToMm(group.rollWidthCm);
  const fits = fileWidthMm && rollMm ? maxCopiesPerRow(fileWidthMm, rollMm) : 0;
  const title = variantLabel(kind, group.variant, group.variantText) ?? cfg.label;

  return (
    <article className="space-y-3 rounded-2xl bg-well p-3.5 sm:p-4" data-item={index} aria-labelledby={`${id("title")}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={id("title")} className="flex min-w-0 items-center gap-2 font-display text-[1.05rem] font-semibold">
          <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-solid text-sm text-on-brand" aria-hidden="true">
            {index + 1}
          </span>
          <span className="truncate">{group.name.trim() || title}</span>
        </h3>
        {count > 1 && (
          <button type="button" onClick={onRemove} className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-red hover:bg-red-soft" aria-label={`حذف السطر ${index + 1}`}>
            <Trash2 className="size-4" aria-hidden="true" />
            حذف
          </button>
        )}
      </div>

      {cfg.variants && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={cfg.variants.title} htmlFor={id("variant")} error={e("variant")}>
            <NativeSelect id={id("variant")} value={group.variant} onChange={(ev) => onChange({ variant: ev.target.value })} aria-invalid={e("variant") ? true : undefined}>
              <option value="">اختار</option>
              {cfg.variants.options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {group.variant === OTHER_VARIANT && (
            <Field label="اكتب النوع" htmlFor={id("variantText")} error={e("variantText")}>
              <Input id={id("variantText")} value={group.variantText} onChange={(ev) => onChange({ variantText: ev.target.value })} aria-invalid={e("variantText") ? true : undefined} />
            </Field>
          )}
          {cfg.threadColor && (
            <Field label="لون الخيط" htmlFor={id("threadColor")} optional>
              <Input id={id("threadColor")} value={group.threadColor} onChange={(ev) => onChange({ threadColor: ev.target.value })} placeholder="مثال: ذهبي" />
            </Field>
          )}
        </div>
      )}

      <Field label={cfg.materialName ? "اسم الخامة" : "اسم السطر"} htmlFor={id("name")} error={e("name")} optional={!cfg.materialName} hint={cfg.materialName ? undefined : `فاضي = «${cfg.label} — ${title}»`}>
        <Input id={id("name")} value={group.name} onChange={(ev) => onChange({ name: ev.target.value })} placeholder={cfg.materialName ? "مثال: ورق DTF رول 60 سم، حبر أبيض" : undefined} aria-invalid={e("name") ? true : undefined} />
      </Field>

      {linearKind ? (
        <div className="space-y-3 rounded-xl bg-surface p-3 ring-1 ring-line" data-testid={`linear-${index}`}>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Ruler className="size-4 text-brand" aria-hidden="true" />
            الحساب بالمتر الطولي (عرض الرول ثابت)
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="عرض الرول (سم)" htmlFor={id("roll")} error={e("rollWidthCm")}>
              <Input id={id("roll")} inputMode="decimal" value={group.rollWidthCm} onChange={(ev) => onChange({ rollWidthCm: ev.target.value })} className="tabular" aria-invalid={e("rollWidthCm") ? true : undefined} />
            </Field>
            <Field label="عرض الملف (سم)" htmlFor={id("fw")} error={e("fileWidthCm")}>
              <Input id={id("fw")} inputMode="decimal" value={group.fileWidthCm} onChange={(ev) => onChange({ fileWidthCm: ev.target.value })} className="tabular" aria-invalid={e("fileWidthCm") ? true : undefined} />
            </Field>
            <Field label="طول الملف (سم)" htmlFor={id("fl")} error={e("fileLengthCm")}>
              <Input id={id("fl")} inputMode="decimal" value={group.fileLengthCm} onChange={(ev) => onChange({ fileLengthCm: ev.target.value })} className="tabular" aria-invalid={e("fileLengthCm") ? true : undefined} />
            </Field>
            <Field label="عدد النسخ" htmlFor={id("qty")} error={e("quantity")}>
              <Input id={id("qty")} inputMode="numeric" value={group.quantity} onChange={(ev) => onChange({ quantity: ev.target.value })} className="tabular" aria-invalid={e("quantity") ? true : undefined} />
            </Field>
            <Field label="نسخ جنب بعض في الصف" htmlFor={id("cpr")} error={e("copiesPerRow")} hint={fits > 1 ? `يدخل لحد ${fits} — اكتبها بنفسك لو هتترص كده` : undefined}>
              <Input id={id("cpr")} inputMode="numeric" value={group.copiesPerRow} onChange={(ev) => onChange({ copiesPerRow: ev.target.value })} className="tabular" aria-invalid={e("copiesPerRow") ? true : undefined} />
            </Field>
            <Field label="سعر المتر الطولي" htmlFor={id("price")} error={e("unitPrice")}>
              <MoneyInput id={id("price")} value={group.unitPrice} onChange={(v) => onChange({ unitPrice: v })} invalid={!!e("unitPrice")} disabled={priceLocked} />
            </Field>
          </div>
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-well px-3 py-2.5 text-sm" aria-live="polite">
            <div>
              <dt className="text-xs text-graphite">الطول المحسوب</dt>
              <dd className="tabular font-semibold" data-testid={`meters-${index}`}>{linear?.ok ? `${formatMeters(linear.billableLengthMm)} متر طولي` : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-graphite">إجمالي السطر</dt>
              <dd className="tabular font-display text-lg font-semibold" data-testid={`line-total-${index}`}>{total !== null ? formatMoney(total) : "—"}</dd>
            </div>
            {linear && !linear.ok && <p className="col-span-2 text-xs text-warning-ink">{linear.message}</p>}
          </dl>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {cfg.materialName && (
            <Field label="الوحدة" htmlFor={id("unit")} error={e("saleUnit")}>
              <NativeSelect id={id("unit")} value={group.saleUnit} onChange={(ev) => onChange({ saleUnit: ev.target.value })} aria-invalid={e("saleUnit") ? true : undefined}>
                <option value="">اختار</option>
                {SALE_UNITS.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="الكمية" htmlFor={id("qty")} error={e("quantity")} hint={cfg.materialName && isFractionalUnit(group.saleUnit) ? "ممكن كسور، مثال: 2.75" : undefined}>
            <Input id={id("qty")} inputMode={cfg.materialName && isFractionalUnit(group.saleUnit) ? "decimal" : "numeric"} value={group.quantity} onChange={(ev) => onChange({ quantity: ev.target.value })} className="tabular text-center font-display text-lg font-semibold" aria-invalid={e("quantity") ? true : undefined} />
          </Field>
          <Field label="سعر الوحدة" htmlFor={id("price")} error={e("unitPrice")}>
            <MoneyInput id={id("price")} value={group.unitPrice} onChange={(v) => onChange({ unitPrice: v })} invalid={!!e("unitPrice")} disabled={priceLocked} />
          </Field>
          <p className="col-span-2 flex items-baseline justify-between rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-line">
            <span className="text-graphite">إجمالي السطر</span>
            <span className="tabular font-display text-base font-semibold" data-testid={`line-total-${index}`}>
              {total !== null ? formatMoney(total) : "—"}
            </span>
          </p>
        </div>
      )}

      {departments.length > 0 && (
        <Field label="القسم" htmlFor={id("dept")} error={e("departmentId")}>
          <NativeSelect id={id("dept")} value={departmentId} onChange={(ev) => onChange({ departmentId: ev.target.value })}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field label="ملاحظات السطر" htmlFor={id("notes")} optional>
        <Input id={id("notes")} value={group.notes} onChange={(ev) => onChange({ notes: ev.target.value })} />
      </Field>
      {group.quantity && linear?.ok && <p className="text-xs text-graphite">{formatNumber(linear.rows)} صف × طول الملف = الطول المحسوب. الاستهلاك الفعلي (هالك أو تجربة) بيتسجل في «التكاليف».</p>}
    </article>
  );
}
