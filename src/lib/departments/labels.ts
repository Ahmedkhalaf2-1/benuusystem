/** One department item's place in production, from valid records only. */
export type ItemWorkStatus = "NOT_STARTED" | "IN_PRODUCTION" | "READY" | "DELIVERED" | "CANCELLED";

export const WORK_STATUS_LABELS: Record<ItemWorkStatus, string> = {
  NOT_STARTED: "لسه مبدأش",
  IN_PRODUCTION: "شغال",
  READY: "جاهز",
  DELIVERED: "اتسلم",
  CANCELLED: "ملغي",
};

/** Department access switches, as shown to the owner. */
export const MEMBERSHIP_FLAGS = [
  { key: "canViewWork", label: "يشوف شغل القسم", hint: "البنود والإنتاج والداشبورد. لو اتقفل: مالوش دخول على القسم خالص." },
  { key: "canRecordProduction", label: "يسجّل إنتاج وجاهز", hint: "على بنود القسم بس — مش تسليم للعميل ولا أسعار." },
  { key: "canViewMoney", label: "يشوف قيمة شغل القسم", hint: "الكمية × سعر القطعة لبنود القسم بس — مش إجمالي الأوردر ولا مدفوعات العميل." },
  { key: "canViewCollections", label: "يشوف التحصيل الموزّع على القسم", hint: "نصيب القسم المحسوب بالنسبة من دفعات العميل، والمتبقي. محتاج «قيمة الشغل» كمان. مش فلوس اتدفعت للشريك." },
  { key: "canViewSettlements", label: "يشوف حساب التسوية بتاعه", hint: "الشغل اللي ليه عندنا في القسم ده، واتدفع له كام، والباقي — حسابه هو بس." },
] as const;
