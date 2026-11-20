import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, KeyRound, Layers, Scale, ShieldCheck } from "lucide-react";
import { PartnerSupplierForm } from "@/components/users/partner-supplier-form";
import { formatMoneyString } from "@/lib/money";
import { getPartnerAccountSettlement } from "@/server/services/partner-settlement-service";
import { DepartmentAccessRow } from "@/components/departments/department-admin-forms";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { getAccountDepartments } from "@/server/services/department-service";
import { Flash } from "@/components/flash";
import { UserAvatar } from "@/components/layout/user-avatar";
import { BackLink } from "@/components/page-header";
import { ResetPasswordForm } from "@/components/users/account-forms";
import { AccountStatusForm, PermissionEditor, RevokeSessionsForm } from "@/components/users/permission-editor";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateTimeAr } from "@/lib/dates";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber } from "@/lib/orders/labels";
import { getAccount } from "@/server/services/staff-access-service";

export const metadata: Metadata = { title: "صلاحيات الموظف" };

const FLASH: Record<string, string> = {
  permissions: "تم حفظ الصلاحيات ✓",
  activated: "الحساب اتفعّل ✓",
  deactivated: "الحساب اتوقف واتقفل دخوله من كل الأجهزة",
  "signed-out": "اتقفل دخوله من كل الأجهزة ✓",
  created: "تم إنشاء الحساب ✓ — حدد صلاحياته تحت",
  password: "تم تغيير كلمة السر واتقفل دخوله من كل الأجهزة ✓",
  departments: "تم حفظ الدخول على القسم ✓",
  supplier: "تم حفظ ربط الشريك بحساب المورد ✓",
  "department-revoked": "اتشال الدخول على القسم ✓",
};

export default async function UserAccessPage(props: PageProps<"/users/[id]">) {
  const user = await requirePermission("users:manage");
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  const account = await getAccount(prisma, user, id);
  if (!account) notFound();
  const partner = account.role === "PARTNER";
  const editable = (account.role === "STAFF" || partner) && account.id !== user.id;
  const departments = editable ? await getAccountDepartments(prisma, user, account.id) : null;
  const settlement = partner && editable ? await getPartnerAccountSettlement(prisma, user, account.id) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <BackLink href="/users" label="المستخدمين والصلاحيات" />

      <section className="stage relative overflow-hidden rounded-2xl p-5 text-on-panel">
        <div className="relative flex items-center gap-3.5">
          <UserAvatar name={account.name} className="size-14 text-lg" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold">{account.name}</h1>
            <p dir="ltr" className="truncate text-end text-sm text-on-panel-muted">
              {account.email}
            </p>
            <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
              <span className="inline-flex h-6 items-center rounded-full bg-panel-2 px-2.5 font-semibold ring-1 ring-panel-line">{ROLE_LABELS[account.role]}</span>
              <span className={account.isActive ? "inline-flex h-6 items-center rounded-full bg-panel-2 px-2.5 ring-1 ring-panel-line" : "inline-flex h-6 items-center rounded-full bg-danger-soft px-2.5 font-semibold text-danger-ink"}>
                {account.isActive ? "نشط" : "موقوف"}
              </span>
              <span className="inline-flex h-6 items-center rounded-full bg-panel-2 px-2.5 ring-1 ring-panel-line">داخل على {formatNumber(account.sessions)} جهاز</span>
            </p>
            {account.lastLoginAt && <p className="mt-1 text-xs text-on-panel-muted">آخر دخول {formatDateTimeAr(account.lastLoginAt)}</p>}
          </div>
        </div>
      </section>

      {!editable ? (
        <p className="flex items-start gap-2 rounded-2xl border border-line bg-surface p-4 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden="true" />
          {account.id === user.id ? "ده حسابك. مينفعش تعدّل صلاحيات حسابك إنت." : "حساب مدير: دايمًا ليه كل الصلاحيات، وبيتدار من السيرفر بس."}
        </p>
      ) : (
        <>
          {departments && (
            <section id="departments" className="scroll-mt-20 rounded-2xl border border-line bg-surface p-4" aria-labelledby="departments-heading">
              <h2 id="departments-heading" className="flex items-center gap-2 font-display font-semibold">
                <Layers className="size-4 text-violet" aria-hidden="true" />
                الأقسام
              </h2>
              <p className="mt-1 text-sm text-graphite">
                {partner
                  ? "الشريك بيشوف بنود الأقسام دي بس — مش الأوردر كله ولا إجماليه ولا تليفون العميل ولا مدفوعاته."
                  : "اختياري للموظف: يشوف داشبورد القسم وبنوده. صلاحياته العادية على الأوردرات زي ما هي."}
              </p>
              <ul className="mt-3 space-y-2.5">
                {departments.all.map((d) => (
                  <DepartmentAccessRow
                    key={d.id}
                    userId={account.id}
                    departmentId={d.id}
                    name={d.name}
                    active={d.isActive}
                    membership={departments.memberships.find((m) => m.departmentId === d.id) ?? null}
                  />
                ))}
              </ul>
            </section>
          )}
          {settlement && (
            <section id="settlement" className="scroll-mt-20 space-y-3 rounded-2xl border border-line bg-surface p-4" aria-labelledby="settlement-heading">
              <h2 id="settlement-heading" className="flex items-center gap-2 font-display font-semibold">
                <Scale className="size-4 text-violet" aria-hidden="true" />
                حساب التسوية
              </h2>
              <p className="text-sm text-graphite">
                شغل الشريك بيتسجل كتكلفة على الأوردر (بسعر متفق عليه للشغلانة أو للقطعة) على حساب المورد ده، والدفع له من صفحة المورد. منفصل عن تحصيل العميل.
              </p>
              <PartnerSupplierForm userId={account.id} current={settlement.supplier?.id ?? null} suppliers={settlement.suppliers} />
              {settlement.settlement && (
                <dl className="grid grid-cols-3 gap-1 rounded-2xl bg-well py-3 text-center text-sm">
                  <div>
                    <dt className="text-xs text-graphite">المستحق</dt>
                    <dd className="tabular font-semibold">{formatMoneyString(settlement.settlement.totals.payable)}</dd>
                  </div>
                  <div className="border-x border-hairline">
                    <dt className="text-xs text-graphite">اتدفع</dt>
                    <dd className="tabular font-semibold text-success-ink">{formatMoneyString(settlement.settlement.totals.paid)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-graphite">الباقي</dt>
                    <dd className="tabular font-semibold text-violet">{formatMoneyString(settlement.settlement.totals.remaining)}</dd>
                  </div>
                </dl>
              )}
              {settlement.supplier && (
                <Link href={`/suppliers/${settlement.supplier.id}`} className="inline-flex text-sm font-semibold text-violet hover:underline">
                  افتح حساب المورد ({settlement.supplier.name}) — الدفع والسجل
                </Link>
              )}
            </section>
          )}
          {partner && (
            <p className="flex items-start gap-2 rounded-2xl border border-line bg-surface p-4 text-sm">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden="true" />
              حساب شريك: مالوش أي صلاحيات عامة (أوردرات، عملاء، فلوس، تقارير) حتى لو اتسجلت بالغلط — بيدخل على الأقسام اللي فوق بس.
            </p>
          )}
          {!partner && account.ignoredPermissions.length > 0 && (
            <p className="rounded-2xl bg-warning-soft p-3.5 text-sm text-warning-ink">
              في صلاحيات متسجلة على الحساب ومش شغالة (ناقصها صلاحية تانية أو للمدير بس): <span dir="ltr">{account.ignoredPermissions.join(", ")}</span>. لما تحفظ هتتشال.
            </p>
          )}
          {!partner && <PermissionEditor userId={account.id} initial={account.permissions} version={account.version} />}

          {!partner && <section className="rounded-2xl border border-line bg-surface p-4" aria-labelledby="orders-access-heading">
            <h2 id="orders-access-heading" className="flex items-center gap-2 font-display font-semibold">
              <ClipboardList className="size-4 text-violet" aria-hidden="true" />
              الأوردرات اللي يقدر يشوفها
            </h2>
            {!account.permissions.includes("orders:view") ? (
              <p className="mt-1 text-sm text-graphite">مالوش «يشوف الأوردرات»، فمش هيشوف أي أوردر حتى لو اتحدد له.</p>
            ) : (
              <p className="mt-1 text-sm text-graphite">
                {formatNumber(account.sharedWithAllStaff)} أوردر ظاهر لكل العاملين، و{formatNumber(account.assignedOrders)} أوردر متحدد له بالاسم. الأوردرات الخاصة بالمدير مش بتظهر له.
              </p>
            )}
            {account.orders.length > 0 && (
              <ul className="mt-3 divide-y divide-hairline">
                {account.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-violet">
                      <span className="min-w-0 truncate">
                        {o.customerName} — {o.title}
                      </span>
                      <span dir="ltr" className="tabular shrink-0 text-xs text-graphite">
                        {formatOrderNumber(o.number)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-graphite">تغيّر مين يشوف أوردر معيّن من صفحة الأوردر نفسه («ظهور الأوردر للعمال»).</p>
          </section>}

          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-labelledby="sessions-heading">
            <h2 id="sessions-heading" className="flex items-center gap-2 font-display font-semibold">
              <KeyRound className="size-4 text-violet" aria-hidden="true" />
              الدخول والحالة
            </h2>
            <RevokeSessionsForm userId={account.id} sessions={account.sessions} />
            <AccountStatusForm userId={account.id} active={account.isActive} version={account.version} />
            <ResetPasswordForm userId={account.id} />
          </section>
        </>
      )}
    </div>
  );
}
