import { todayDateString } from "@/lib/dates";
import { toCents, formatAmount } from "@/lib/money";
import type { OrderDetails } from "@/server/services/order-service";
import type { PaymentMethod, PrintOperation, QuantityUnit, OrderStatus } from "@/generated/prisma/enums";
import { PLACEMENTS, type Placement } from "@/lib/orders/labels";
import { formatMeters, isLegacyLinear, isWorkKind, itemWorkSummary, type WorkKind } from "@/lib/orders/work-kinds";
import type { CustomerChoice } from "./customer-picker";

/** Form state of the order form (strings exactly as typed). Shared by server and client. */
/** One size row as typed: label + pieces (empty pieces = not included). */
export type SizeDraft = { label: string; quantity: string };

/** One design («رسمة») on an item's pieces, as typed. */
export type DesignDraft = {
  key: string;
  /** Existing design id (edit only) — keeps its production records attached. */
  id?: string;
  name: string;
  operation: PrintOperation | null;
  placements: Placement[];
  /** «أخرى» switched on, and what was typed (several places separated by «،» or ","). */
  otherOn: boolean;
  otherText: string;
  /** Empty = every piece of the item. */
  quantity: string;
  pressesPerUnit: string;
  notes: string;
};

export function newDesignDraft(partial: Partial<DesignDraft> = {}): DesignDraft {
  const key = `d-${Math.random().toString(36).slice(2, 10)}`;
  return { key, name: "", operation: null, placements: [], otherOn: false, otherText: "", quantity: "", pressesPerUnit: "", notes: "", ...partial };
}

/** «أخرى» text → separate custom placements. */
export function customPlacementsOf(d: DesignDraft): string[] {
  return d.otherOn ? d.otherText.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean) : [];
}

export type GroupDraft = {
  key: string;
  /** Existing group id (edit only) — preserved so linked worker records stay valid. */
  id?: string;
  /** «اسم البند / الرسمة». */
  name: string;
  /** Selling price per unit (item pricing). */
  unitPrice: string;
  /** Planned presses per piece — items without designs only. */
  pressesPerUnit: string;
  /** Item work is described by designs (new items) instead of item-level operations (older items). */
  useDesigns: boolean;
  /**
   * «منتج جاهز»: a finished product sold as is — no printing or embroidery,
   * so no designs (saved as a «بدون» item; no stock is tracked).
   */
  readyMade: boolean;
  /** «القسم» chosen for the item; "" = not chosen yet (the suggested one is shown and sent). */
  departmentId: string;
  /** Work-kind line (src/lib/orders/work-kinds.ts): kind, material/method and measurement as typed. */
  workKind: WorkKind | "";
  variant: string;
  variantText: string;
  threadColor: string;
  saleUnit: string;
  /** Linear-meter lines (DTF / vinyl): file length in METERS as typed. Copies = quantity. */
  fileLengthM: string;
  /**
   * An item saved under the old cm / roll-width rule: its stored billed length
   * stays authoritative while the length and copies are unchanged.
   */
  legacyLinear: { fileLengthMm: number; copies: number; billableLengthMm: number; summary: string } | null;
  designs: DesignDraft[];
  quantity: string;
  material: string;
  operations: PrintOperation[];
  plain: boolean;
  notes: string;
  sizes: SizeDraft[];
};

export type OrderDraft = {
  /** "items": total = Σ quantity × unit price. "order": one agreed total (older orders). */
  pricing: "items" | "order";
  /** Owner confirms that converting to item pricing changes the agreed total. */
  confirmPriceChange: boolean;
  customer: CustomerChoice | null;
  title: string;
  productType: string;
  material: string;
  quantity: string;
  unit: QuantityUnit;
  groups: GroupDraft[];
  totalPrice: string;
  advance: string;
  advanceMethod: PaymentMethod;
  /** Day the advance was actually paid (defaults to today, not the receipt date). */
  advancePaidAt: string;
  receivedDate: string;
  deliveryDate: string;
  notes: string;
  status: OrderStatus;
  /** «بنعمل إيه؟» work kind for the whole order ("" = garments / ready-made, as before). */
  workKind: WorkKind | "";
  /** "تقسيم بالمقاسات" switch. */
  sizesEnabled: boolean;
  /** The employee changed the switch themselves: stop suggesting it from the product type. */
  sizesTouched: boolean;
};

export function newGroupDraft(partial: Partial<GroupDraft> = {}): GroupDraft {
  const key = `g-${Math.random().toString(36).slice(2, 10)}`;
  return {
    key,
    name: "",
    unitPrice: "",
    pressesPerUnit: "",
    useDesigns: true,
    readyMade: false,
    departmentId: "",
    workKind: "",
    variant: "",
    variantText: "",
    threadColor: "",
    saleUnit: "",
    fileLengthM: "",
    legacyLinear: null,
    designs: [newDesignDraft()],
    quantity: "",
    material: "",
    operations: [],
    plain: false,
    notes: "",
    sizes: [],
    ...partial,
  };
}

export function emptyOrderDraft(customer: OrderDraft["customer"] = null): OrderDraft {
  return {
    pricing: "items",
    confirmPriceChange: false,
    customer,
    title: "",
    productType: "",
    material: "",
    quantity: "",
    unit: "PIECE",
    groups: [newGroupDraft()],
    totalPrice: "",
    advance: "",
    advanceMethod: "CASH",
    advancePaidAt: todayDateString(),
    receivedDate: todayDateString(),
    deliveryDate: "",
    notes: "",
    status: "NEW",
    workKind: "",
    sizesEnabled: false,
    sizesTouched: false,
  };
}


/** A new line of a work-kind order (one per material / method). */
export function newWorkLine(kind: WorkKind, partial: Partial<GroupDraft> = {}): GroupDraft {
  return newGroupDraft({ workKind: kind, useDesigns: true, readyMade: false, plain: true, designs: [], ...partial });
}

const plainAmount = (value: string) => formatAmount(toCents(value)).replace(/,/g, "");

export function draftFromOrder(order: OrderDetails): OrderDraft {
  return {
    pricing: order.pricing === "PER_ITEM" ? "items" : "order",
    confirmPriceChange: false,
    customer: { mode: "existing", id: order.customerId, name: order.customerName, phone: order.customerPhone },
    title: order.title,
    productType: order.productType,
    material: order.material,
    quantity: String(order.quantity),
    unit: order.unit,
    groups: order.groups.map((g) => {
      // No designs and no work type = a finished product («بدون»): shown as «منتج جاهز».
      const readyMade = g.designs.length === 0 && g.operations.length === 0;
      return newGroupDraft({
        id: g.id,
        name: g.name ?? "",
        // Older items have no price of their own: left empty, never split from the total.
        unitPrice: g.unitPrice == null ? "" : plainAmount(g.unitPrice),
        pressesPerUnit: g.pressesPerUnit === null ? "" : String(g.pressesPerUnit),
        useDesigns: g.designs.length > 0 || readyMade,
        readyMade: readyMade && !g.work.workKind,
        departmentId: g.department?.id ?? "",
        workKind: isWorkKind(g.work.workKind) ? g.work.workKind : "",
        variant: g.work.variant ?? "",
        variantText: g.work.variantText ?? "",
        threadColor: g.work.threadColor ?? "",
        saleUnit: g.work.saleUnit ?? "",
        fileLengthM: g.work.fileLengthMm == null ? "" : formatMeters(g.work.fileLengthMm),
        legacyLinear:
          g.work.pricingBasis === "LINEAR_METER" && isLegacyLinear(g.work) && g.work.fileLengthMm != null && g.work.billableLengthMm != null
            ? { fileLengthMm: g.work.fileLengthMm, copies: g.quantity, billableLengthMm: g.work.billableLengthMm, summary: itemWorkSummary(g.work, g.quantity) ?? "" }
            : null,
        designs: g.designs.map((d) =>
          newDesignDraft({
            id: d.id,
            name: d.name ?? "",
            operation: d.operation,
            placements: d.placements.filter((p): p is Placement => (PLACEMENTS as readonly string[]).includes(p)),
            otherOn: d.customPlacements.length > 0,
            otherText: d.customPlacements.join("، "),
            quantity: d.quantity === g.quantity ? "" : String(d.quantity),
            pressesPerUnit: d.pressesPerUnit === null ? "" : String(d.pressesPerUnit),
            notes: d.notes ?? "",
          }),
        ),
        // Measured lines (e.g. 2.75 kg) edit their decimal quantity, not the delivery lot.
        quantity: g.work.measuredQuantity ?? String(g.quantity),
        material: g.material !== order.material ? g.material : "",
        operations: g.operations,
        plain: g.operations.length === 0,
        notes: g.notes ?? "",
        sizes: g.sizes.map((x) => ({ label: x.label, quantity: String(x.quantity) })),
      });
    }),
    totalPrice: order.money ? plainAmount(order.money.totalPrice) : "",
    advance: "",
    advanceMethod: "CASH",
    advancePaidAt: todayDateString(),
    receivedDate: order.receivedDate,
    deliveryDate: order.deliveryDate,
    notes: order.notes ?? "",
    status: order.status,
    // One work kind on every item → the order is that kind of work.
    workKind: order.groups.length > 0 && order.groups.every((g) => g.work.workKind && g.work.workKind === order.groups[0]!.work.workKind) && isWorkKind(order.groups[0]!.work.workKind) ? order.groups[0]!.work.workKind : "",
    sizesEnabled: order.sizesEnabled,
    sizesTouched: true,
  };
}
