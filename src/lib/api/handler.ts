import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, isAppError } from "@/lib/errors";
import { toFieldErrors } from "@/lib/validations/utils";

/**
 * Uniform JSON envelope for every API route:
 *   success → { ok: true, data }
 *   failure → { ok: false, error: { code, message, fieldErrors? } }
 */
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; fieldErrors?: Record<string, string[]> };
};

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, init);
}

export function apiError(error: unknown) {
  let appError: AppError;
  if (isAppError(error)) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: toFieldErrors(error),
    });
  } else {
    console.error("[api] unexpected error", error);
    appError = new AppError("INTERNAL_ERROR");
  }

  return NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
      },
    },
    { status: appError.status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Wraps a route handler so thrown errors become the standard error response. */
export function withApiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return apiError(error);
    }
  };
}

/** Parses a JSON body with a Zod schema; throws a 400 AppError on bad input. */
export async function parseJsonBody<T>(
  request: Request,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "صيغة البيانات المرسلة غير صحيحة");
  }
  return schema.parse(body);
}
