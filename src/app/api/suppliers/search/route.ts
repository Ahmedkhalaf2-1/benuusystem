import { apiOk, withApiHandler } from "@/lib/api/handler";
import { requireApiUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { customerSearchSchema } from "@/lib/validations/customer";
import { searchSuppliers } from "@/server/services/supplier-service";

/** Supplier picker lookup: GET /api/suppliers/search?q=أحمد */
export const GET = withApiHandler(async (request: Request) => {
  const user = await requireApiUser("suppliers:view");
  const q = customerSearchSchema.parse(new URL(request.url).searchParams.get("q") ?? "");
  return apiOk(await searchSuppliers(prisma, user, q), { headers: { "Cache-Control": "no-store" } });
});
