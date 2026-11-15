/** "دقيقة واحدة" / "دقيقتين" / "3 دقائق" / "15 دقيقة" — Arabic count agreement. */
export function formatMinutesAr(minutes: number): string {
  const n = Math.max(1, Math.round(minutes));
  if (n === 1) return "دقيقة واحدة";
  if (n === 2) return "دقيقتين";
  if (n <= 10) return `${n} دقائق`;
  return `${n} دقيقة`;
}

/** Time-of-day greeting for the dashboard (server time, Africa/Cairo by default). */
export function greetingAr(date: Date, timeZone = "Africa/Cairo"): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(date),
  );
  if (hour >= 4 && hour < 12) return "صباح الخير";
  return "مساء الخير";
}
