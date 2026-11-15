import { apiOk, withApiHandler } from "@/lib/api/handler";
import { requireApiUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { customerSearchSchema } from "@/lib/validations/customer";
import { searchCustomers } from "@/server/services/customer-service";

/** Customer picker lookup: GET /api/customers/search?q=محمود */
export const GET = withApiHandler(async (request: Request) => {
  const user = await requireApiUser("customers:view");
  const q = customerSearchSchema.parse(new URL(request.url).searchParams.get("q") ?? "");
  const customers = await searchCustomers(prisma, user, q);
  return apiOk(customers, { headers: { "Cache-Control": "no-store" } });
});
