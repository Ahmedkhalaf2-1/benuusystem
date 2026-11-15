/**
 * Application errors with a safe, user-facing Arabic message.
 * Anything that is not an AppError is treated as an unexpected 500 and its
 * details are only logged on the server, never sent to the client.
 */
export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

const DEFAULT_MESSAGE: Record<AppErrorCode, string> = {
  VALIDATION_ERROR: "البيانات المدخلة غير صحيحة",
  UNAUTHENTICATED: "يجب تسجيل الدخول أولًا",
  FORBIDDEN: "ليس لديك صلاحية لتنفيذ هذا الإجراء",
  NOT_FOUND: "العنصر المطلوب غير موجود",
  CONFLICT: "هذا العنصر موجود بالفعل",
  RATE_LIMITED: "محاولات كثيرة، حاول مرة أخرى لاحقًا",
  INTERNAL_ERROR: "حدث خطأ غير متوقع، حاول مرة أخرى",
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Optional per-field messages, e.g. from Zod. */
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: AppErrorCode,
    message?: string,
    options?: { fieldErrors?: Record<string, string[]>; cause?: unknown },
  ) {
    super(message ?? DEFAULT_MESSAGE[code], { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = options?.fieldErrors;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
