import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";

/**
 * Logout lives on the account page («المزيد») only, behind a confirmation, so a
 * stray tap in a busy workshop never signs someone out. Works without JavaScript.
 */
export function LogoutButton({ className }: { variant?: "full"; className?: string }) {
  return (
    <details data-logout className={cn("group/logout rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)]", className)}>
      <summary className="flex h-14 cursor-pointer list-none items-center justify-center gap-2 rounded-[1.4rem] font-display font-semibold text-red transition-colors hover:bg-red-soft [&::-webkit-details-marker]:hidden">
        <LogOut className="size-5 rtl:rotate-180" aria-hidden="true" />
        تسجيل الخروج
      </summary>
      <form action={logoutAction} className="space-y-3 px-4 pb-4">
        <p className="text-center text-sm text-graphite">متأكد إنك عايز تخرج من الحساب؟</p>
        <div className="flex gap-2">
          <button
            type="submit"
            aria-label="تسجيل الخروج"
            className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-red font-semibold text-white shadow-[0_10px_22px_-12px_rgb(220_59_59/0.8)] transition-transform active:scale-[0.97]"
          >
            أيوه، اخرج
          </button>
        </div>
      </form>
    </details>
  );
}
