import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Prev/next links that keep the other query parameters. */
export function Pagination({
  page,
  pageCount,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
    if (p > 1) search.set("page", String(p));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const linkClass = "inline-flex h-11 items-center gap-1 rounded-xl border bg-card px-4 text-sm font-medium";
  return (
    <nav aria-label="الصفحات" className="mt-6 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClass}>
          <ChevronRight className="size-4" aria-hidden="true" />
          السابق
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground">
        صفحة {page} من {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={cn(linkClass)}>
          التالي
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
