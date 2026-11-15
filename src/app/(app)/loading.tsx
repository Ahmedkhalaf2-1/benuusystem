/** Shown instantly while a screen loads: the shape of the page, gently pulsing. */
export default function Loading() {
  const block = "animate-pulse rounded-[1.4rem] bg-surface shadow-[var(--shadow-soft)] motion-reduce:animate-none";
  return (
    <div role="status" aria-label="جاري التحميل" className="space-y-4">
      <div className="h-36 animate-pulse rounded-[1.9rem] bg-gradient-to-br from-[#3a1a9c]/25 to-[#24106b]/20 motion-reduce:animate-none" />
      <div className="grid grid-cols-3 gap-2.5">
        <div className={`${block} h-24`} />
        <div className={`${block} h-24`} />
        <div className={`${block} h-24`} />
      </div>
      <div className={`${block} h-28`} />
      <div className={`${block} h-28`} />
      <span className="sr-only">جاري التحميل…</span>
    </div>
  );
}
