import { describe, expect, it } from "vitest";
import { getClientIp } from "@/lib/auth/request-context";
import { formatMinutesAr, greetingAr } from "@/lib/format";

describe("getClientIp", () => {
  it("uses the right-most X-Forwarded-For entry (the one the reverse proxy added)", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(getClientIp(headers)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});

describe("Arabic formatting", () => {
  it("agrees minute counts", () => {
    expect(formatMinutesAr(1)).toBe("دقيقة واحدة");
    expect(formatMinutesAr(2)).toBe("دقيقتين");
    expect(formatMinutesAr(5)).toBe("5 دقائق");
    expect(formatMinutesAr(15)).toBe("15 دقيقة");
  });

  it("greets by Cairo time of day", () => {
    expect(greetingAr(new Date("2026-01-01T07:00:00Z"))).toBe("صباح الخير"); // 09:00 Cairo
    expect(greetingAr(new Date("2026-01-01T18:00:00Z"))).toBe("مساء الخير"); // 20:00 Cairo
  });
});
