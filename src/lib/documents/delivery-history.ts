/**
 * Delivery history for the order invoice — physical pieces handed to the
 * customer, from valid (not voided) Delivery records ONLY. Production stages,
 * printing/embroidery operations and "ready" confirmations are never added:
 * a garment that needs DTF and embroidery is still one garment, and it is
 * counted once, when a Delivery record says it was handed over.
 *
 * One delivery form on a sized group saves one Delivery row per size, in one
 * transaction, milliseconds apart. There is no stored batch id, so a handover
 * is INFERRED conservatively: consecutive size rows of the same group, date,
 * recorder and notes, saved within 2 seconds of each other, with no size
 * repeated (one form can't list a size twice). Anything else is shown as its
 * own line — same-day deliveries stay separate. No batch id is invented.
 */

export type DeliveryRow = {
  id: string;
  groupId: string;
  groupPosition: number;
  /** Null for groups without sizes. */
  sizeLabel: string | null;
  sizePosition: number | null;
  quantity: number;
  /** "YYYY-MM-DD" */
  deliveredAt: string;
  createdAt: Date;
  recordedById: string;
  notes: string | null;
};

export type DeliveryGroupInfo = { id: string; position: number; quantity: number };

export type DeliveryEntry = {
  /** 1, 2, 3 … in chronological order. */
  seq: number;
  date: string;
  groupPosition: number;
  quantity: number;
  /** Delivered sizes in this handover (empty for unsized groups). */
  sizes: { label: string; quantity: number }[];
  notes: string | null;
  /** Total delivered for the whole order after this handover. */
  cumulative: number;
  /** Order quantity − cumulative (negative only if records exceed the order). */
  remaining: number;
};

export type DeliveryStatus = "none" | "partial" | "complete";

export type DeliveryHistory = {
  entries: DeliveryEntry[];
  /** Order quantity: the sum of its groups. */
  total: number;
  delivered: number;
  remaining: number;
  /** complete = every group fully delivered (the same rule that completes the order). */
  status: DeliveryStatus;
  lastDate: string | null;
  /** Groups whose delivered pieces exceed their quantity (data needing a look). */
  overDeliveredGroups: number[];
};

/** Max gap between size rows saved by one delivery form (they are ms apart). */
export const SAME_FORM_WINDOW_MS = 2000;

function sameForm(handover: DeliveryRow[], row: DeliveryRow): boolean {
  const first = handover[0]!;
  const last = handover.at(-1)!;
  return (
    row.sizeLabel !== null &&
    first.sizeLabel !== null &&
    row.groupId === first.groupId &&
    row.deliveredAt === first.deliveredAt &&
    row.recordedById === first.recordedById &&
    (row.notes ?? "") === (first.notes ?? "") &&
    row.createdAt.getTime() - last.createdAt.getTime() <= SAME_FORM_WINDOW_MS &&
    !handover.some((r) => r.sizeLabel === row.sizeLabel)
  );
}

export function buildDeliveryHistory(groups: readonly DeliveryGroupInfo[], validRows: readonly DeliveryRow[]): DeliveryHistory {
  const total = groups.reduce((s, g) => s + g.quantity, 0);

  // Stable chronological order: date, then when it was recorded, then id.
  const rows = [...validRows].sort(
    (a, b) => a.deliveredAt.localeCompare(b.deliveredAt) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  const handovers: DeliveryRow[][] = [];
  for (const row of rows) {
    const current = handovers.at(-1);
    if (current && sameForm(current, row)) current.push(row);
    else handovers.push([row]);
  }

  let cumulative = 0;
  const entries: DeliveryEntry[] = handovers.map((list, i) => {
    const first = list[0]!;
    const quantity = list.reduce((s, r) => s + r.quantity, 0);
    cumulative += quantity;
    const sizes = list
      .filter((r) => r.sizeLabel !== null)
      .sort((a, b) => (a.sizePosition ?? 0) - (b.sizePosition ?? 0))
      .map((r) => ({ label: r.sizeLabel!, quantity: r.quantity }));
    return { seq: i + 1, date: first.deliveredAt, groupPosition: first.groupPosition, quantity, sizes, notes: first.notes, cumulative, remaining: total - cumulative };
  });

  const deliveredByGroup = new Map<string, number>();
  for (const r of rows) deliveredByGroup.set(r.groupId, (deliveredByGroup.get(r.groupId) ?? 0) + r.quantity);
  const delivered = cumulative;
  const complete = groups.length > 0 && groups.every((g) => (deliveredByGroup.get(g.id) ?? 0) >= g.quantity);

  return {
    entries,
    total,
    delivered,
    remaining: total - delivered,
    status: delivered === 0 ? "none" : complete ? "complete" : "partial",
    lastDate: entries.at(-1)?.date ?? null,
    overDeliveredGroups: groups.filter((g) => (deliveredByGroup.get(g.id) ?? 0) > g.quantity).map((g) => g.position),
  };
}

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  none: "لم يتم التسليم",
  partial: "تسليم جزئي",
  complete: "مكتمل التسليم",
};
