import type { FinancialAccountType } from "@/generated/prisma/enums";

export const ACCOUNT_TYPE_LABELS: Record<FinancialAccountType, string> = {
  CASH: "خزنة كاش",
  BANK: "حساب بنكي",
  WALLET: "محفظة إلكترونية",
};

/** Names only — what payment forms may show to anyone recording money. */
export type AccountOption = { id: string; name: string; type: FinancialAccountType };
