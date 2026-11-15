import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Works without JavaScript too: a plain form posting to a server action. */
export function LogoutButton({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "full";
  className?: string;
}) {
  return (
    <form action={logoutAction} className={cn(variant === "full" && "w-full", className)}>
      {variant === "icon" ? (
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-label="تسجيل الخروج"
          title="تسجيل الخروج"
          className="text-muted-foreground"
        >
          <LogOut className="size-5 rtl:rotate-180" />
        </Button>
      ) : (
        <Button type="submit" variant="outline" size="lg" className="w-full text-destructive">
          <LogOut className="size-5 rtl:rotate-180" />
          تسجيل الخروج
        </Button>
      )}
    </form>
  );
}
