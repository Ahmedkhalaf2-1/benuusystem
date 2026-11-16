import { z } from "zod";
import type { PrintOperation } from "@/generated/prisma/enums";
import { MAX_CENTS, parseMoney, type Cents } from "@/lib/money";
import { isValidDateString, todayDateString } from "@/lib/dates";
import { parseWholeNumber } from "@/lib/numbers";
import { MAX_SIZES_PER_GROUP, normalizeSizeLabel } from "@/lib/orders/sizes";
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
  material: requiredText(80, "اكتب نوع الخامة"),
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

/** An item's quantity: its own, or the order's when it is the only item and has none. */
function groupQuantity(data: CoreParsed, group: CoreParsed["groups"][number]): number | null {
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
    total += BigInt(qty) * price;
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
    if (group.designs.length > 0) {
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
      if (multiple || data.quantity === undefined)
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
    // With designs, the item's required operations are exactly its designs' operations.
    const operations =
      designs.length > 0
        ? PRINT_OPERATIONS.filter((op) =>
            designs.some((d) => d.operation === op),
          )
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
      sizes: data.sizesEnabled ? group.sizes : [],
      name: group.name ?? null,
      unitPrice: perItem ? (unitPriceOf(group.unitPrice) as Cents) : null,
      pressesPerUnit:
        designs.length > 0 ? null : (pressesOf(group.pressesPerUnit) ?? null),
    };
  });
  const quantity = groups.reduce((s, g) => s + g.quantity, 0);
  const totalPrice = perItem
    ? groups.reduce((s, g) => s + BigInt(g.quantity) * g.unitPrice!, 0n)
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
  })
  .superRefine((data, ctx) => {
    checkOrderRules(data, ctx);
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
