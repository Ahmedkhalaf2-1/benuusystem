import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission, homePathFor, isPartner } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { SIDEBAR_EXTRA_NAV, mainNavKeys } from "@/lib/navigation";
import { hasDepartmentAccess } from "@/server/services/department-access";

/**
 * Shell for every signed-in screen. The session is verified here AND in each
 * page (layouts are not re-rendered on client-side navigation, so pages must
 * not rely on the layout's check alone).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const partner = isPartner(user);
  const mainKeys = mainNavKeys((p) => hasPermission(user, p), { partner });
  const departments = !partner && (await hasDepartmentAccess(prisma, user));
  const extraKeys = partner ? [] : SIDEBAR_EXTRA_NAV.filter((i) => (i.permission === null ? departments : hasPermission(user, i.permission))).map((i) => i.key);

  return (
    <div className="min-h-dvh">
      <SidebarNav mainKeys={mainKeys} extraKeys={extraKeys} homeHref={homePathFor(user)} />
      <div className="lg:ps-64">
        <AppHeader user={user} />
        <main className="mx-auto max-w-6xl px-4 pt-3 pb-36 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      </div>
      <BottomNav mainKeys={mainKeys} canCreateOrder={hasPermission(user, "orders:create")} />
    </div>
  );
}
