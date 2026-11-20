import { todayDateString } from "@/lib/dates";
import { toCents, formatAmount } from "@/lib/money";
import type { OrderDetails } from "@/server/services/order-service";
import type { PaymentMethod, PrintOperation, QuantityUnit, OrderStatus } from "@/generated/prisma/enums";
import { PLACEMENTS, type Placement } from "@/lib/orders/labels";
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
    sizesEnabled: false,
    sizesTouched: false,
  };
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
        readyMade,
        departmentId: g.department?.id ?? "",
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
        quantity: String(g.quantity),
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
    sizesEnabled: order.sizesEnabled,
    sizesTouched: true,
  };
}
