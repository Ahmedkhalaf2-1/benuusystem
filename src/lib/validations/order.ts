import { paymentAccountSchema } from "./utils";
import { z } from "zod";
import type { PrintOperation } from "@/generated/prisma/enums";
import { MAX_CENTS, parseMoney, type Cents } from "@/lib/money";
import { isValidDateString, todayDateString } from "@/lib/dates";
import { parseWholeNumber } from "@/lib/numbers";
import { MAX_SIZES_PER_GROUP, normalizeSizeLabel } from "@/lib/orders/sizes";
import { checkLinear, isFractionalUnit, isWorkKind, linearLineCents, metersToMm, OTHER_VARIANT, SALE_UNITS, WORK_KIND_CONFIG, type LinearCheck, type WorkKind } from "@/lib/orders/work-kinds";
import { formatQuantity, parseQuantity, usageTotalCents } from "@/lib/finance/usage";
import {
  MAX_CUSTOM_PLACEMENTS,
  PAYMENT_METHODS,
  PLACEMENTS,
  PRINT_OPERATIONS,
  QUANTITY_UNITS,
} from "@/lib/orders/labels";
import { customerNameSchema, phoneSchema } from "./customer";

/** Shared by the order form (client, for instant errors) and the server. */

/** Safety limit on line items («بنود») per order. */
export const MAX_ORDER_GROUPS = 30;
export const MAX_PRESSES_PER_UNIT = 100;
/** Safety limit on designs per item. */
export const MAX_DESIGNS_PER_ITEM = 12;
/** "order": one agreed total (legacy). "items": total = Σ quantity × unit price, computed here. */
export const ORDER_PRICING = ["order", "items"] as const;
export type OrderPricingMode = (typeof ORDER_PRICING)[number];
export const MAX_ORDER_QUANTITY = 1_000_000;

const requiredText = (max: number, required: string) =>
  z
    .string({ error: required })
    .trim()
    .min(1, required)
    .max(max, "النص طويل جدًا");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "النص طويل جدًا")
    .optional()
    .transform((value) => (value ? value : undefined));

const quantitySchema = (required: string) =>
  z
    .union([z.string(), z.number()], { error: required })
    .transform((value, ctx) => {
      const n = parseWholeNumber(value);
      if (n === null || n <= 0) {
        ctx.addIssue({ code: "custom", message: required });
        return z.NEVER;
      }
      if (n > MAX_ORDER_QUANTITY) {
        ctx.addIssue({ code: "custom", message: "الكمية كبيرة جدًا" });
        return z.NEVER;
      }
      return n;
    });

/** Money typed by a person ("40,000", "٤٠٠٠٠") → piasters. */
export const moneySchema = (options: {
  required: string;
  allowZero?: boolean;
}) =>
  z.string({ error: options.required }).transform((value, ctx): Cents => {
    const trimmed = value.trim();
    if (trimmed === "" && options.allowZero) return 0n;
    const cents = parseMoney(trimmed);
    if (cents === null) {
      ctx.addIssue({
        code: "custom",
        message:
          trimmed === ""
            ? options.required
            : "اكتب المبلغ بالأرقام بس، مثال: 40000",
      });
      return z.NEVER;
    }
    if (cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "المبلغ كبير جدًا" });
      return z.NEVER;
    }
    if (cents === 0n && !options.allowZero) {
      ctx.addIssue({ code: "custom", message: options.required });
      return z.NEVER;
    }
    return cents;
  });

export const dateStringSchema = (required: string) =>
  z.string({ error: required }).trim().refine(isValidDateString, required);

export const RECEIVED_DATE_FUTURE_MESSAGE = "تاريخ الاستلام مينفعش يكون في المستقبل";

const customerChoiceSchema = z.discriminatedUnion(
  "mode",
  [
    z.object({
      mode: z.literal("existing"),
      id: z.uuid("اختار العميل من القائمة"),
    }),
    z.object({
      mode: z.literal("new"),
      name: customerNameSchema,
      phone: phoneSchema,
    }),
  ],
  { error: "اختار العميل أو اكتب اسم عميل جديد" },
);

/** One size of a group: label + pieces. `id` keeps an existing size's identity on edit. */
const sizeSchema = z.object({
  id: z.uuid().optional(),
  label: z
    .string({ error: "اكتب المقاس" })
    .transform((v) => normalizeSizeLabel(v))
    .refine((v) => v.length > 0, "اكتب المقاس")
    .refine((v) => v.length <= 24, "اسم المقاس طويل جدًا"),
  quantity: z.union([z.string(), z.number()]).transform((v, ctx) => {
    const n = parseWholeNumber(v);
    if (n === null || n <= 0) {
      ctx.addIssue({ code: "custom", message: "اكتب العدد" });
      return z.NEVER;
    }
    return n;
  }),
});

/**
 * One design on an item's pieces («رسمة»): a single operation at one or more
 * placements. `quantity` = pieces that get it (empty = every piece of the
 * item); it is work, never extra physical pieces.
 */
const designSchema = z.object({
  /** Existing design id when editing (keeps its production records attached). */
  id: z.uuid().optional(),
  name: optionalText(120),
  operation: z
    .enum(PRINT_OPERATIONS as [string, ...string[]], {
      error: "اختار نوع الشغل",
    })
    .transform((o) => o as PrintOperation),
  placements: z
    .array(z.enum(PLACEMENTS))
    .max(PLACEMENTS.length)
    .default([])
    .transform((list) => [...new Set(list)]),
  customPlacements: z
    .array(z.string().trim().max(40, "اسم المكان طويل جدًا"))
    .default([])
    .transform((list) => [...new Set(list.filter(Boolean))])
    .refine(
      (list) => list.length <= MAX_CUSTOM_PLACEMENTS,
      `أقصى ${MAX_CUSTOM_PLACEMENTS} أماكن إضافية`,
    ),
  quantity: z.union([z.string(), z.number()]).optional(),
  pressesPerUnit: z.union([z.string(), z.number()]).optional(),
  notes: optionalText(500),
});

const groupSchema = z.object({
  /** Existing group id when editing — kept so records pointing at the group stay valid. */
  id: z.uuid().optional(),
  /** Ignored (taken from the order) when there is only one group. */
  quantity: z.union([z.string(), z.number()]).optional(),
  material: optionalText(80),
  operations: z
    .array(z.enum(PRINT_OPERATIONS as [string, ...string[]]))
    .max(PRINT_OPERATIONS.length)
    .default([])
    .transform((ops) => [...new Set(ops)] as PrintOperation[]),
  /** "بدون طباعة أو تطريز" chosen explicitly. */
  plain: z.boolean().default(false),
  notes: optionalText(500),
  /** Size breakdown (only used when the order has sizes switched on). */
  sizes: z
    .array(sizeSchema)
    .max(MAX_SIZES_PER_GROUP, "عدد المقاسات كبير جدًا")
    .default([]),
  /** «اسم البند / الرسمة» — required with item pricing. */
  name: optionalText(120),
  /** Selling price per unit as typed — required with item pricing. */
  unitPrice: z.string().optional(),
  /** Planned presses per piece (optional, capacity planning; items without designs). */
  pressesPerUnit: z.union([z.string(), z.number()]).optional(),
  /**
   * «القسم» that does this item (one per item). Optional in the contract for
   * older callers: when missing, the server keeps the item's current
   * department or applies the documented suggestion rule.
   */
  departmentId: z.uuid("اختار القسم").optional(),
  /** «نوع الشغل» (src/lib/orders/work-kinds.ts); empty = garment / ready-made item. */
  workKind: z.string().optional().transform((v) => (v ? v : undefined)),
  /** Material / method of this line (a code from the work kind's options, or OTHER). */
  variant: z.string().trim().max(40).optional().transform((v) => (v ? v : undefined)),
  variantText: optionalText(120),
  threadColor: optionalText(60),
  saleUnit: z.string().optional().transform((v) => (v ? v : undefined)),
  /**
   * Linear-meter items (DTF / vinyl): the file length in METERS (up to 3
   * decimals). Copies = the item quantity; the unit price is per linear meter.
   * Older width / per-row / roll fields are not accepted (a cm length is never
   * read as meters).
   */
  fileLengthM: z.union([z.string(), z.number()]).optional(),
  /** Designs on this item's pieces. When present, the item's operations are theirs. */
  designs: z
    .array(designSchema)
    .max(MAX_DESIGNS_PER_ITEM, `أقصى عدد رسومات للبند ${MAX_DESIGNS_PER_ITEM}`)
    .default([]),
});

/** Fields shared by "new order" and "edit order". */
const orderCoreShape = {
  customer: customerChoiceSchema,
  title: requiredText(150, "اكتب اسم الأوردر"),
  productType: requiredText(80, "اكتب نوع المنتج"),
  /** Optional: stored as "" (shown as «—») when not given. */
  material: z
    .string()
    .trim()
    .max(80, "النص طويل جدًا")
    .optional()
    .transform((value) => value ?? ""),
  pricing: z.enum(ORDER_PRICING).default("order"),
  /** Optional: when missing it is the sum of the items' quantities. */
  quantity: quantitySchema("اكتب الكمية المطلوبة").optional(),
  unit: z
    .enum(QUANTITY_UNITS as [string, ...string[]])
    .transform((u) => u as (typeof QUANTITY_UNITS)[number]),
  groups: z
    .array(groupSchema)
    .min(1, "ضيف بند واحد على الأقل")
    .max(MAX_ORDER_GROUPS, `أقصى عدد بنود ${MAX_ORDER_GROUPS}`),
  /** "المقاسات": when on, every group lists sizes that add up to its quantity. */
  sizesEnabled: z.boolean().default(false),
  /** Order-total pricing only; ignored (computed) with item pricing. */
  totalPrice: moneySchema({ required: "اكتب إجمالي سعر الأوردر" }).optional(),
  receivedDate: dateStringSchema("اختار تاريخ استلام الأوردر"),
  deliveryDate: dateStringSchema("اختار موعد التسليم"),
  notes: optionalText(2000),
};

type CoreParsed = {
  pricing: OrderPricingMode;
  quantity?: number;
  totalPrice?: Cents;
  material: string;
  receivedDate: string;
  deliveryDate: string;
  sizesEnabled: boolean;
  groups: z.infer<typeof groupSchema>[];
};

type GroupIn = z.infer<typeof groupSchema>;

function kindOf(group: GroupIn): WorkKind | null {
  return isWorkKind(group.workKind) ? group.workKind : null;
}

/** Linear-meter measurement of an item (null when the item isn't priced by linear meter). */
function linearOf(group: GroupIn, copies: number | null): LinearCheck | null {
  const kind = kindOf(group);
  if (!kind || WORK_KIND_CONFIG[kind].pricing !== "LINEAR_METER") return null;
  return checkLinear({ fileLengthMm: metersToMm(group.fileLengthM) ?? 0, copies: copies ?? 0 });
}

/**
 * Raw materials sold in a fractional unit (kg, liter, meter…): the quantity is
 * a decimal (up to 3 places) and the line is one lot to deliver.
 * undefined = not a measured line; null = invalid quantity.
 */
function measuredOf(group: GroupIn): bigint | null | undefined {
  if (kindOf(group) !== "RAW_MATERIALS" || !isFractionalUnit(group.saleUnit)) return undefined;
  const milli = parseQuantity(group.quantity ?? null);
  return milli !== null && milli > 0n ? milli : null;
}

const LINEAR_FIELD: Record<string, string> = { fileLengthMm: "fileLengthM", copies: "quantity" };

/** An item's quantity: its own, or the order's when it is the only item and has none. */
function groupQuantity(data: CoreParsed, group: CoreParsed["groups"][number]): number | null {
  // A measured line (e.g. 2.75 kg) is one lot physically; its decimal quantity prices it.
  const measured = measuredOf(group);
  if (measured !== undefined) return measured === null ? null : 1;
  // A single item with an order-level quantity takes that quantity (original rule).
  if (data.groups.length === 1 && data.quantity !== undefined) return data.quantity;
  return parseWholeNumber(group.quantity ?? null);
}

/** Unit price as typed → piasters; undefined when empty, null when not a number. */
function unitPriceOf(raw: string | undefined): Cents | null | undefined {
  const text = raw?.trim() ?? "";
  if (text === "") return undefined;
  const cents = parseMoney(text);
  return cents === null || cents > MAX_CENTS ? null : cents;
}

/** Presses per piece → number (0 allowed: no heat press); undefined when empty, null when invalid. */
function pressesOf(
  raw: string | number | undefined,
): number | null | undefined {
  if (raw === undefined || String(raw).trim() === "") return undefined;
  const n = parseWholeNumber(raw);
  return n === null || n < 0 || n > MAX_PRESSES_PER_UNIT ? null : n;
}

/** A design's pieces: its own number, or every piece of the item when empty. */
function designQuantity(
  raw: string | number | undefined,
  itemQuantity: number | null,
): number | null {
  if (raw === undefined || String(raw).trim() === "") return itemQuantity;
  return parseWholeNumber(raw);
}

/**
 * Item pricing: Σ quantity × unit price in exact piasters. Null when any item
 * is missing a quantity or a valid price (the form shows those errors).
 */
export function computeItemsTotal(
  data: Pick<CoreParsed, "groups" | "quantity">,
): Cents | null {
  let total = 0n;
  for (const group of data.groups) {
    const qty = groupQuantity(data as CoreParsed, group);
    const price = unitPriceOf(group.unitPrice);
    if (qty === null || price === null || price === undefined) return null;
    const linear = linearOf(group, qty);
    if (linear && !linear.ok) return null;
    const measured = measuredOf(group);
    total += linear ? linearLineCents(linear.billableLengthMm, price) : measured ? usageTotalCents(measured, price) : BigInt(qty) * price;
  }
  return total;
}

/** Cross-field rules: item quantities and prices, work type per item, dates. */
function checkOrderRules(data: CoreParsed, ctx: z.RefinementCtx) {
  if (data.deliveryDate < data.receivedDate) {
    ctx.addIssue({
      code: "custom",
      path: ["deliveryDate"],
      message: "موعد التسليم لازم يكون بعد تاريخ الاستلام",
    });
  }

  const multiple = data.groups.length > 1;
  const perItem = data.pricing === "items";
  let sum = 0;
  let allQuantities = true;
  data.groups.forEach((group, index) => {
    const qtyForDesigns = groupQuantity(data, group);
    const kind = kindOf(group);
    if (group.workKind && !kind) {
      ctx.addIssue({ code: "custom", path: ["groups", index, "workKind"], message: "نوع الشغل مش معروف" });
    }
    if (kind) {
      checkWorkKind(kind, group, index, data, ctx);
    } else if (group.designs.length > 0) {
      if (group.plain)
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "operations"],
          message: "البند ده عليه رسومات — شيل «بدون طباعة» أو امسح الرسومات",
        });
      group.designs.forEach((design, d) => {
        const q = designQuantity(design.quantity, qtyForDesigns);
        if (q === null || q <= 0) {
          ctx.addIssue({
            code: "custom",
            path: ["groups", index, "designs", d, "quantity"],
            message: "اكتب عدد القطع اللي عليها الرسمة",
          });
        } else if (qtyForDesigns !== null && q > qtyForDesigns) {
          ctx.addIssue({
            code: "custom",
            path: ["groups", index, "designs", d, "quantity"],
            message: `أكتر من كمية البند (${qtyForDesigns})`,
          });
        }
        if (pressesOf(design.pressesPerUnit) === null) {
          ctx.addIssue({
            code: "custom",
            path: ["groups", index, "designs", d, "pressesPerUnit"],
            message: `عدد الكبسات من 0 لـ ${MAX_PRESSES_PER_UNIT}`,
          });
        }
      });
    } else if (kind) {
      // checked by checkWorkKind
    } else if (group.plain && group.operations.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["groups", index, "operations"],
        message: "اختار طباعة/تطريز أو «بدون»، مش الاتنين",
      });
    } else if (!group.plain && group.operations.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["groups", index, "operations"],
        message: "اختار نوع الشغل: DTF أو سلك سكرين أو تطريز أو بدون",
      });
    }
    const qty = groupQuantity(data, group);
    if (qty === null || qty <= 0) {
      allQuantities = false;
      // A measured line's own message (decimals) is added by checkWorkKind.
      if ((multiple || data.quantity === undefined) && measuredOf(group) !== null)
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "quantity"],
          message: "اكتب كمية البند",
        });
    } else if (qty > MAX_ORDER_QUANTITY) {
      ctx.addIssue({
        code: "custom",
        path: ["groups", index, "quantity"],
        message: "الكمية كبيرة جدًا",
      });
    } else {
      sum += qty;
    }
    if (pressesOf(group.pressesPerUnit) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["groups", index, "pressesPerUnit"],
        message: `عدد الكبسات من 0 لـ ${MAX_PRESSES_PER_UNIT}`,
      });
    }
    if (perItem) {
      if (!group.name)
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "name"],
          message: "اكتب اسم البند / الرسمة",
        });
      const price = unitPriceOf(group.unitPrice);
      if (price === undefined)
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "unitPrice"],
          message: "اكتب سعر القطعة",
        });
      else if (price === null)
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "unitPrice"],
          message: "اكتب السعر بالأرقام بس، مثال: 25",
        });
    }
  });

  if (data.sizesEnabled) {
    data.groups.forEach((group, index) => {
      if (kindOf(group)) return; // work-kind items have no size breakdown
      const groupQty = groupQuantity(data, group);
      const seen = new Set<string>();
      for (const size of group.sizes) {
        if (seen.has(size.label)) {
          ctx.addIssue({
            code: "custom",
            path: ["groups", index, "sizes"],
            message: `المقاس ${size.label} متكرر`,
          });
          return;
        }
        seen.add(size.label);
      }
      const sizeSum = group.sizes.reduce((s, x) => s + x.quantity, 0);
      if (group.sizes.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "sizes"],
          message:
            "اكتب كمية كل مقاس (أو اقفل «المقاسات» لو الأوردر من غير مقاسات)",
        });
      } else if (groupQty !== null && groupQty > 0 && sizeSum !== groupQty) {
        ctx.addIssue({
          code: "custom",
          path: ["groups", index, "sizes"],
          message:
            sizeSum < groupQty
              ? `لسه ${groupQty - sizeSum} قطعة محتاجة توزيع على المقاسات`
              : `المقاسات زيادة ${sizeSum - groupQty} قطعة عن كمية البند`,
        });
      }
    });
  }

  if (
    data.quantity !== undefined &&
    multiple &&
    allQuantities &&
    sum !== data.quantity
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["groups"],
      message: `مجموع كميات البنود (${sum}) لازم يساوي الكمية المطلوبة (${data.quantity})`,
    });
  }

  if (perItem) {
    const total = computeItemsTotal(data);
    if (total !== null && total <= 0n)
      ctx.addIssue({
        code: "custom",
        path: ["totalPrice"],
        message: "إجمالي الأوردر لازم يكون أكبر من صفر",
      });
    if (total !== null && total > MAX_CENTS)
      ctx.addIssue({
        code: "custom",
        path: ["totalPrice"],
        message: "إجمالي الأوردر كبير جدًا",
      });
  } else if (data.totalPrice === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["totalPrice"],
      message: "اكتب إجمالي سعر الأوردر",
    });
  }
}

/** Per-work-kind rules, all from WORK_KIND_CONFIG. */
function checkWorkKind(kind: WorkKind, group: GroupIn, index: number, data: CoreParsed, ctx: z.RefinementCtx) {
  const cfg = WORK_KIND_CONFIG[kind];
  const at = (field: string, message: string) => ctx.addIssue({ code: "custom", path: ["groups", index, field], message });
  // The production step (if any) comes from the config, never from the browser.
  if (group.designs.length > 0) at("workKind", `${cfg.label} من غير رسومات`);
  if (cfg.variants) {
    const codes = cfg.variants.options.map((o) => o.code);
    if (!group.variant || !codes.includes(group.variant)) at("variant", `اختار ${cfg.variants.title}`);
    else if (group.variant === OTHER_VARIANT && !group.variantText) at("variantText", "اكتب النوع");
  } else if (group.variant) {
    at("variant", "النوع ده مالوش اختيارات");
  }
  if (cfg.materialName) {
    if (!group.name) at("name", "اكتب اسم الخامة");
    if (!group.saleUnit || !SALE_UNITS.some((u) => u.code === group.saleUnit)) at("saleUnit", "اختار الوحدة");
    else if (measuredOf(group) === null) at("quantity", "اكتب الكمية (لحد 3 أرقام عشرية، مثال: 2.75)");
  }
  if (cfg.pricing === "LINEAR_METER") {
    if (data.pricing !== "items") at("unitPrice", "ورق DTF والفينيل بيتسعّروا بالمتر الطولي — لازم تسعير بالبند");
    const linear = linearOf(group, groupQuantity(data, group));
    if (linear && !linear.ok) at(LINEAR_FIELD[linear.field] ?? linear.field, linear.message);
  }
}

/**
 * Normalizes items (quantities filled in, material defaults to the order's)
 * and computes the authoritative order quantity and total. With item pricing
 * the total is always Σ quantity × unit price — a total sent by the browser
 * is ignored.
 */
function normalizeOrder(data: CoreParsed) {
  const perItem = data.pricing === "items";
  const groups = data.groups.map((group) => {
    const quantity = groupQuantity(data, group)!;
    const designs = group.designs.map((design) => ({
      id: design.id,
      name: design.name ?? null,
      operation: design.operation,
      placements: design.placements,
      customPlacements: design.customPlacements,
      // Work on the item's pieces — never added to the physical quantity.
      quantity: designQuantity(design.quantity, quantity)!,
      pressesPerUnit: pressesOf(design.pressesPerUnit) ?? null,
      notes: design.notes ?? null,
    }));
    const kind = kindOf(group);
    const linear = linearOf(group, quantity);
    const measured = measuredOf(group);
    const productionOp = kind ? (WORK_KIND_CONFIG[kind].production?.(group.variant ?? null) ?? null) : null;
    // With designs, the item's required operations are exactly its designs' operations.
    const operations =
      designs.length > 0
        ? PRINT_OPERATIONS.filter((op) =>
            designs.some((d) => d.operation === op),
          )
        : kind
          ? productionOp
            ? [productionOp]
            : []
          : group.plain
            ? []
            : group.operations;
    return {
      id: group.id,
      quantity,
      material: group.material ?? data.material,
      operations: operations as PrintOperation[],
      designs,
      notes: group.notes,
      // Sizes switched off → no breakdown is stored, whatever the form still holds.
      sizes: data.sizesEnabled && !kind ? group.sizes : [],
      workKind: kind,
      variant: kind ? (group.variant ?? null) : null,
      variantText: kind ? (group.variantText ?? null) : null,
      threadColor: kind && WORK_KIND_CONFIG[kind].threadColor ? (group.threadColor ?? null) : null,
      saleUnit: kind && WORK_KIND_CONFIG[kind].materialName ? (group.saleUnit ?? null) : null,
      pricingBasis: (linear ? "LINEAR_METER" : measured ? "MEASURED" : "UNIT") as "LINEAR_METER" | "UNIT" | "MEASURED",
      measuredQuantity: measured ? formatQuantity(measured) : null,
      linear: linear && linear.ok
        ? {
            fileLengthMm: metersToMm(group.fileLengthM)!,
            billableLengthMm: linear.billableLengthMm,
            // Removed from the sale: never stored for new lines.
            fileWidthMm: null,
            copiesPerRow: null,
            rollWidthMm: null,
          }
        : null,
      name: group.name ?? null,
      unitPrice: perItem ? (unitPriceOf(group.unitPrice) as Cents) : null,
      /** Resolved (checked / suggested) by the order service. */
      departmentId: group.departmentId ?? null,
      pressesPerUnit:
        designs.length > 0 ? null : (pressesOf(group.pressesPerUnit) ?? null),
    };
  });
  const quantity = groups.reduce((s, g) => s + g.quantity, 0);
  const totalPrice = perItem
    ? groups.reduce((s, g) => s + (g.linear ? linearLineCents(g.linear.billableLengthMm, g.unitPrice!) : g.measuredQuantity ? usageTotalCents(parseQuantity(g.measuredQuantity)!, g.unitPrice!) : BigInt(g.quantity) * g.unitPrice!), 0n)
    : data.totalPrice!;
  return { quantity, totalPrice, groups };
}

export const createOrderSchema = z
  .object({
    ...orderCoreShape,
    idempotencyKey: z.uuid(),
    advance: moneySchema({ required: "اكتب المقدم", allowZero: true }).default(
      0n,
    ),
    advanceMethod: z
      .enum(PAYMENT_METHODS as [string, ...string[]])
      .default("CASH"),
    /**
     * When the advance was actually paid — NOT the receipt date (a backdated
     * order's advance may have been paid on another day, and the date decides
     * the treasury rule). Never in the future. Missing (older clients) = today.
     */
    advancePaidAt: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined))
      .refine((value) => value === undefined || isValidDateString(value), "اختار تاريخ دفع المقدم")
      .refine(
        (value) => value === undefined || !isValidDateString(value) || value <= todayDateString(),
        "تاريخ دفع المقدم مينفعش يكون في المستقبل",
      ),
    /** Treasury account the advance went into (optional). */
    advanceAccountId: paymentAccountSchema,
  })
  .superRefine((data, ctx) => {
    checkOrderRules(data, ctx);
    // A new order is never received in the future (edits check this only when the date changes).
    if (isValidDateString(data.receivedDate) && data.receivedDate > todayDateString()) {
      ctx.addIssue({ code: "custom", path: ["receivedDate"], message: RECEIVED_DATE_FUTURE_MESSAGE });
    }
    const total =
      data.pricing === "items"
        ? computeItemsTotal(data)
        : (data.totalPrice ?? null);
    if (total !== null && data.advance > total) {
      ctx.addIssue({
        code: "custom",
        path: ["advance"],
        message: "المقدم أكبر من إجمالي سعر الأوردر",
      });
    }
  })
  .transform((data) => ({
    ...data,
    ...normalizeOrder(data),
    advanceMethod: data.advanceMethod as (typeof PAYMENT_METHODS)[number],
    advancePaidAt: data.advancePaidAt ?? todayDateString(),
  }));

export type CreateOrderInput = z.output<typeof createOrderSchema>;
export type CreateOrderPayload = z.input<typeof createOrderSchema>;

export const EDITABLE_STATUSES = ["NEW", "IN_PROGRESS", "CANCELLED"] as const;

export const updateOrderSchema = z
  .object({
    ...orderCoreShape,
    orderId: z.uuid(),
    status: z.enum(EDITABLE_STATUSES, { error: "اختار حالة الأوردر" }),
    /** The order's updatedAt when the edit form was opened (stale-edit protection). */
    expectedUpdatedAt: z.iso.datetime().optional(),
    /** Required when switching an order-total order to item pricing changes its total. */
    confirmPriceChange: z.boolean().default(false),
  })
  .superRefine((data, ctx) => checkOrderRules(data, ctx))
  .transform((data) => ({ ...data, ...normalizeOrder(data) }));

export type UpdateOrderInput = z.output<typeof updateOrderSchema>;
export type UpdateOrderPayload = z.input<typeof updateOrderSchema>;

export const recordPaymentSchema = z.object({
  orderId: z.uuid(),
  idempotencyKey: z.uuid(),
  amount: moneySchema({ required: "اكتب مبلغ الدفعة" }),
  paidAt: dateStringSchema("اختار تاريخ الدفعة").refine(
    (value) => value <= todayDateString(),
    "تاريخ الدفعة مينفعش يكون في المستقبل",
  ),
  method: z
    .enum(PAYMENT_METHODS as [string, ...string[]], {
      error: "اختار طريقة الدفع",
    })
    .transform((m) => m as (typeof PAYMENT_METHODS)[number]),
  notes: optionalText(500),
  accountId: paymentAccountSchema,
});

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;

export const voidPaymentSchema = z.object({
  paymentId: z.uuid(),
  reason: z
    .string({ error: "اكتب سبب الإلغاء" })
    .trim()
    .min(3, "اكتب سبب الإلغاء")
    .max(300, "السبب طويل جدًا"),
});
