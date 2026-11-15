import { todayDateString } from "@/lib/dates";
import { toCents, formatAmount } from "@/lib/money";
import type { OrderDetails } from "@/server/services/order-service";
import type { PaymentMethod, PrintOperation, QuantityUnit, OrderStatus } from "@/generated/prisma/enums";
import type { CustomerChoice } from "./customer-picker";

/** Form state of the order form (strings exactly as typed). Shared by server and client. */
export type GroupDraft = {
  key: string;
  quantity: string;
  material: string;
  operations: PrintOperation[];
  plain: boolean;
  notes: string;
};

export type OrderDraft = {
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
  receivedDate: string;
  deliveryDate: string;
  notes: string;
  status: OrderStatus;
};

export function newGroupDraft(partial: Partial<GroupDraft> = {}): GroupDraft {
  const key = `g-${Math.random().toString(36).slice(2, 10)}`;
  return { key, quantity: "", material: "", operations: [], plain: false, notes: "", ...partial };
}

export function emptyOrderDraft(customer: OrderDraft["customer"] = null): OrderDraft {
  return {
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
    receivedDate: todayDateString(),
    deliveryDate: "",
    notes: "",
    status: "NEW",
  };
}

export function draftFromOrder(order: OrderDetails): OrderDraft {
  const multiple = order.groups.length > 1;
  return {
    customer: { mode: "existing", id: order.customerId, name: order.customerName, phone: order.customerPhone },
    title: order.title,
    productType: order.productType,
    material: order.material,
    quantity: String(order.quantity),
    unit: order.unit,
    groups: order.groups.map((g) =>
      newGroupDraft({
        quantity: multiple ? String(g.quantity) : "",
        material: multiple && g.material !== order.material ? g.material : "",
        operations: g.operations,
        plain: g.operations.length === 0,
        notes: g.notes ?? "",
      }),
    ),
    totalPrice: formatAmount(toCents(order.totalPrice)).replace(/,/g, ""),
    advance: "",
    advanceMethod: "CASH",
    receivedDate: order.receivedDate,
    deliveryDate: order.deliveryDate,
    notes: order.notes ?? "",
    status: order.status,
  };
}
