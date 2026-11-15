"use client";

import { EntityPicker, type EntityChoice } from "@/components/forms/entity-picker";

export type SupplierChoice = EntityChoice;

const SUPPLIER_TEXTS = {
  searchUrl: "/api/suppliers/search",
  placeholder: "اكتب اسم المورد (اختياري)",
  newNoun: "مورد جديد",
  existingNoun: "مورد مسجّل",
  newPendingNote: "مورد جديد — هيتسجل مع التكلفة",
  phoneLabel: "موبايل المورد",
  notFound: "مفيش مورد بالاسم ده.",
  emptyHint: "اكتب اسم المورد عشان تدوّر عليه أو تضيفه.",
  loadFailed: "مقدرناش نجيب الموردين. اكتب الاسم كمورد جديد أو حاول تاني.",
};

export function SupplierPicker(props: {
  value: SupplierChoice | null;
  onChange: (value: SupplierChoice | null) => void;
  error?: string;
  phoneError?: string;
}) {
  return <EntityPicker {...props} texts={SUPPLIER_TEXTS} />;
}
