import { apiError, apiOk, withApiHandler } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";

/** Public liveness + database check, for uptime monitoring and deploy scripts. */
export const GET = withApiHandler(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("[health] database check failed", error);
    const response = apiError(new AppError("INTERNAL_ERROR", "قاعدة البيانات غير متاحة"));
    return new Response(response.body, { status: 503, headers: response.headers });
  }
  return apiOk({ status: "ok", database: "ok" }, { headers: { "Cache-Control": "no-store" } });
});
