import type { Metadata } from "next";
import { Flash } from "@/components/flash";
import { PageHeader } from "@/components/page-header";
import { CreatePresetForm, PresetRow } from "@/components/orders/preset-forms";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { listPresetsForAdmin } from "@/server/services/product-preset-service";

export const metadata: Metadata = { title: "المنتجات الجاهزة" };

const FLASH: Record<string, string> = { created: "المنتج اتضاف ✓", updated: "اتحفظ ✓" };

/** Owner: the «منتج جاهز» shortcuts in the order form (names only — no prices or stock). */
export default async function PresetsPage(props: PageProps<"/orders/presets">) {
  const user = await requirePermission("users:manage");
  const { saved } = await props.searchParams;
  const presets = await listPresetsForAdmin(prisma, user);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <PageHeader title="المنتجات الجاهزة وأنواع الشغل" subtitle="اختصارات «منتج جاهز» في فورم الأوردر. أسماء بس — من غير أسعار ولا مخزون. أي اسم تاني يتكتب عادي." backHref="/more" backLabel="المزيد" />
      <CreatePresetForm />
      <ul className="space-y-2">
        {presets.map((p, i) => (
          <PresetRow key={p.id} id={p.id} name={p.name} isActive={p.isActive} first={i === 0} last={i === presets.length - 1} />
        ))}
      </ul>
    </div>
  );
}
