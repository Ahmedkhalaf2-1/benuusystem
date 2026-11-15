"use client";

import { EntityPicker, type EntityChoice } from "@/components/forms/entity-picker";

export type CustomerChoice = EntityChoice;

const CUSTOMER_TEXTS = {
  searchUrl: "/api/customers/search",
  placeholder: "اكتب اسم العميل أو رقمه",
  newNoun: "عميل جديد",
  existingNoun: "عميل مسجّل",
  newPendingNote: "عميل جديد — هيتسجل مع الأوردر",
  phoneLabel: "موبايل العميل",
  notFound: "مفيش عميل بالاسم ده.",
  emptyHint: "اكتب اسم العميل عشان تدوّر عليه أو تضيفه.",
  loadFailed: "مقدرناش نجيب العملاء. اكتب الاسم كعميل جديد أو حاول تاني.",
};

/** Customer picker for the order form (see EntityPicker). */
export function CustomerPicker(props: {
  value: CustomerChoice | null;
  onChange: (value: CustomerChoice | null) => void;
  error?: string;
  phoneError?: string;
}) {
  return <EntityPicker {...props} texts={CUSTOMER_TEXTS} />;
}
