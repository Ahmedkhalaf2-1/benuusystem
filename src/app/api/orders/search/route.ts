import { apiOk, withApiHandler } from "@/lib/api/handler";
import { requireApiUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { customerSearchSchema } from "@/lib/validations/customer";
import { searchOpenOrders } from "@/server/services/order-service";

/** Open orders for the work-log picker: GET /api/orders/search?q=محمود */
export const GET = withApiHandler(async (request: Request) => {
  const user = await requireApiUser("orders:view");
  const q = customerSearchSchema.parse(new URL(request.url).searchParams.get("q") ?? "");
  return apiOk(await searchOpenOrders(prisma, user, q), { headers: { "Cache-Control": "no-store" } });
});
