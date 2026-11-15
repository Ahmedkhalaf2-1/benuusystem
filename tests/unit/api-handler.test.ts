import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiError, withApiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";

describe("API error handling", () => {
  it("maps AppError to its status and Arabic message", async () => {
    const response = apiError(new AppError("FORBIDDEN"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "ليس لديك صلاحية لتنفيذ هذا الإجراء" },
    });
  });

  it("maps ZodError to 400 with field errors", async () => {
    const parsed = z.object({ name: z.string().min(2, "قصير") }).safeParse({ name: "a" });
    const response = apiError(parsed.error);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fieldErrors).toEqual({ name: ["قصير"] });
  });

  it("hides unexpected error details behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiHandler(async () => {
      throw new Error("connection string postgres://secret@db");
    });
    const response = await handler();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("secret");
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
    spy.mockRestore();
  });
});
