import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { SIDEBAR_EXTRA_NAV } from "@/lib/navigation";

/**
 * Shell for every signed-in screen. The session is verified here AND in each
 * page (layouts are not re-rendered on client-side navigation, so pages must
 * not rely on the layout's check alone).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh">
      <SidebarNav extraKeys={SIDEBAR_EXTRA_NAV.filter((i) => hasPermission(user, i.permission)).map((i) => i.key)} />
      <div className="lg:ps-64">
        <AppHeader user={user} />
        <main className="mx-auto max-w-5xl px-4 pt-5 pb-28 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
