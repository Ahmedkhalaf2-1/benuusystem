import { describe, expect, it } from "vitest";
import { buildDeliveryHistory, type DeliveryRow } from "@/lib/documents/delivery-history";

let n = 0;
const row = (o: Partial<DeliveryRow> & { quantity: number; deliveredAt: string }): DeliveryRow => ({
  id: `d${String(++n).padStart(4, "0")}`,
  groupId: "g1",
  groupPosition: 1,
  sizeLabel: null,
  sizePosition: null,
  createdAt: new Date(`${o.deliveredAt}T10:00:00.${String(n % 1000).padStart(3, "0")}Z`),
  recordedById: "u1",
  notes: null,
  ...o,
});
const G70 = [{ id: "g1", position: 1, quantity: 70 }];

describe("buildDeliveryHistory", () => {
  it("no deliveries: nothing delivered, status «لم يتم التسليم»", () => {
    const h = buildDeliveryHistory(G70, []);
    expect(h).toMatchObject({ entries: [], total: 70, delivered: 0, remaining: 70, status: "none", lastDate: null });
  });

  it("one partial delivery", () => {
    const h = buildDeliveryHistory(G70, [row({ quantity: 20, deliveredAt: "2026-11-15" })]);
    expect(h).toMatchObject({ delivered: 20, remaining: 50, status: "partial", lastDate: "2026-11-15" });
  });

  it("the 70-piece example: 20 → 50 left, 30 → 20 left, 20 → 0 left, complete", () => {
    const h = buildDeliveryHistory(G70, [
      row({ quantity: 20, deliveredAt: "2026-11-15" }),
      row({ quantity: 20, deliveredAt: "2026-11-20" }),
      row({ quantity: 30, deliveredAt: "2026-11-17" }),
    ]);
    expect(h.entries.map((e) => [e.seq, e.date, e.quantity, e.cumulative, e.remaining])).toEqual([
      [1, "2026-11-15", 20, 20, 50],
      [2, "2026-11-17", 30, 50, 20],
      [3, "2026-11-20", 20, 70, 0],
    ]);
    expect(h).toMatchObject({ total: 70, delivered: 70, remaining: 0, status: "complete", lastDate: "2026-11-20" });
  });

  it("size rows saved together are one handover with their sizes, in size order", () => {
    const at = new Date("2026-11-15T10:00:00.123Z");
    const h = buildDeliveryHistory(
      [{ id: "g1", position: 1, quantity: 50 }],
      [
        row({ quantity: 5, deliveredAt: "2026-11-15", sizeLabel: "XL", sizePosition: 2, createdAt: at }),
        row({ quantity: 5, deliveredAt: "2026-11-15", sizeLabel: "S", sizePosition: 0, createdAt: at }),
        row({ quantity: 10, deliveredAt: "2026-11-15", sizeLabel: "M", sizePosition: 1, createdAt: at }),
      ],
    );
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({ quantity: 20, cumulative: 20, remaining: 30 });
    expect(h.entries[0]!.sizes).toEqual([{ label: "S", quantity: 5 }, { label: "M", quantity: 10 }, { label: "XL", quantity: 5 }]);
  });

  it("same-day deliveries recorded separately stay separate (no invented batch)", () => {
    const h = buildDeliveryHistory(
      [{ id: "g1", position: 1, quantity: 50 }],
      [
        row({ quantity: 5, deliveredAt: "2026-11-15", sizeLabel: "S", sizePosition: 0, createdAt: new Date("2026-11-15T09:00:00Z") }),
        row({ quantity: 7, deliveredAt: "2026-11-15", sizeLabel: "S", sizePosition: 0, createdAt: new Date("2026-11-15T15:00:00Z") }),
        row({ quantity: 3, deliveredAt: "2026-11-15", createdAt: new Date("2026-11-15T15:00:00Z") }),
        row({ quantity: 4, deliveredAt: "2026-11-15", createdAt: new Date("2026-11-15T15:00:00Z") }),
      ],
    );
    expect(h.entries.map((e) => e.quantity)).toEqual([5, 7, 3, 4]);
    expect(h.delivered).toBe(19);
  });

  it("size rows more than 2 s apart, or repeating a size, are separate handovers", () => {
    const t = (ms: number) => new Date(Date.parse("2026-11-15T10:00:00Z") + ms);
    const h = buildDeliveryHistory(
      [{ id: "g1", position: 1, quantity: 50 }],
      [
        row({ quantity: 5, deliveredAt: "2026-11-15", sizeLabel: "S", sizePosition: 0, createdAt: t(0) }),
        row({ quantity: 6, deliveredAt: "2026-11-15", sizeLabel: "M", sizePosition: 1, createdAt: t(3) }),
        row({ quantity: 7, deliveredAt: "2026-11-15", sizeLabel: "M", sizePosition: 1, createdAt: t(9) }),
        row({ quantity: 8, deliveredAt: "2026-11-15", sizeLabel: "L", sizePosition: 2, createdAt: t(5000) }),
      ],
    );
    expect(h.entries.map((e) => e.sizes.map((s) => `${s.label}:${s.quantity}`).join(" "))).toEqual(["S:5 M:6", "M:7", "L:8"]);
  });

  it("different notes or recorder on the same timestamp are different handovers", () => {
    const at = new Date("2026-11-15T10:00:00Z");
    const h = buildDeliveryHistory(
      [{ id: "g1", position: 1, quantity: 50 }],
      [
        row({ quantity: 5, deliveredAt: "2026-11-15", sizeLabel: "S", sizePosition: 0, createdAt: at, notes: "مع السواق" }),
        row({ quantity: 5, deliveredAt: "2026-11-15", sizeLabel: "M", sizePosition: 1, createdAt: at, notes: null }),
        row({ quantity: 5, deliveredAt: "2026-11-15", sizeLabel: "L", sizePosition: 2, createdAt: at, recordedById: "u2" }),
      ],
    );
    expect(h.entries).toHaveLength(3);
  });

  it("multiple groups: complete only when every group is fully delivered", () => {
    const groups = [
      { id: "g1", position: 1, quantity: 40 },
      { id: "g2", position: 2, quantity: 30 },
    ];
    const partial = buildDeliveryHistory(groups, [row({ quantity: 40, deliveredAt: "2026-11-10" }), row({ groupId: "g2", groupPosition: 2, quantity: 20, deliveredAt: "2026-11-11" })]);
    expect(partial).toMatchObject({ total: 70, delivered: 60, remaining: 10, status: "partial" });
    expect(partial.entries.map((e) => e.groupPosition)).toEqual([1, 2]);
    const done = buildDeliveryHistory(groups, [row({ quantity: 40, deliveredAt: "2026-11-10" }), row({ groupId: "g2", groupPosition: 2, quantity: 30, deliveredAt: "2026-11-11" })]);
    expect(done.status).toBe("complete");
  });

  it("never double counts: the total equals the sum of the rows exactly once", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({ quantity: (i % 3) + 1, deliveredAt: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` }));
    const h = buildDeliveryHistory([{ id: "g1", position: 1, quantity: 1000 }], rows);
    const sum = rows.reduce((s, r) => s + r.quantity, 0);
    expect(h.delivered).toBe(sum);
    expect(h.entries.reduce((s, e) => s + e.quantity, 0)).toBe(sum);
    expect(h.entries.at(-1)!.cumulative).toBe(sum);
  });

  it("flags records that exceed a group's quantity instead of hiding them", () => {
    const h = buildDeliveryHistory([{ id: "g1", position: 1, quantity: 10 }], [row({ quantity: 12, deliveredAt: "2026-11-01" })]);
    expect(h.remaining).toBe(-2);
    expect(h.overDeliveredGroups).toEqual([1]);
  });
});
