"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { attributePayment, createAccount, reconcileAccount, recordMovement, setAccountActive, voidMovement } from "@/server/services/treasury-service";

/** Every action re-checks "treasury:manage" in the service (owner only). */
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : undefined;
};

export async function createAccountAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() =>
    createAccount(prisma, user, {
      name: str(f, "name"),
      type: str(f, "type"),
      openingBalance: str(f, "openingBalance"),
      openingDate: str(f, "openingDate"),
      notes: str(f, "notes"),
      confirmed: f.get("confirmed") === "yes",
    }),
  );
  if (failure) return failure;
  redirect("/treasury?saved=account");
}

export async function setAccountActiveAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => setAccountActive(prisma, user, { accountId: str(f, "accountId"), active: f.get("active") === "yes" }));
  if (failure) return failure;
  redirect("/treasury?saved=account-status");
}

export async function recordMovementAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() =>
    recordMovement(prisma, user, {
      kind: str(f, "kind"),
      accountId: str(f, "accountId"),
      toAccountId: str(f, "toAccountId"),
      direction: str(f, "direction"),
      amount: str(f, "amount"),
      date: str(f, "date"),
      notes: str(f, "notes"),
      idempotencyKey: str(f, "idempotencyKey"),
    }),
  );
  if (failure) return failure;
  redirect(`/treasury?saved=movement`);
}

export async function voidMovementAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() => voidMovement(prisma, user, { id: str(f, "id"), reason: str(f, "reason") }));
  if (failure) return failure;
  redirect("/treasury/ledger?saved=voided");
}

export async function reconcileAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let diff = "";
  const failure = await toActionResult(async () => {
    const r = await reconcileAccount(prisma, user, {
      accountId: str(f, "accountId"),
      date: str(f, "date"),
      counted: str(f, "counted"),
      notes: str(f, "notes"),
      adjust: f.get("adjust") === "yes",
      idempotencyKey: str(f, "idempotencyKey"),
    });
    diff = r.difference;
  });
  if (failure) return failure;
  redirect(`/treasury?saved=reconciled&diff=${encodeURIComponent(diff)}`);
}

export async function attributePaymentAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const failure = await toActionResult(() =>
    attributePayment(prisma, user, { side: str(f, "side"), paymentId: str(f, "paymentId"), accountId: str(f, "accountId"), reason: str(f, "reason") }),
  );
  if (failure) return failure;
  redirect("/treasury?saved=attributed#unattributed");
}
