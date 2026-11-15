import { withApiHandler } from "@/lib/api/handler";
import { requireApiUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { renderStatement } from "@/server/documents/customer-documents";
import { pdfResponse } from "@/server/documents/pdf-response";
import { getCustomerStatement, parsePeriod } from "@/server/services/customer-documents-service";

/** GET /api/documents/customers/{id}/statement[?from&to&download=1] — owner only. */
export const GET = withApiHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser("documents:customer-financial");
  const { id } = await context.params;
  const sp = new URL(request.url).searchParams;
  const data = await getCustomerStatement(prisma, user, id, parsePeriod({ from: sp.get("from"), to: sp.get("to") }));
  if (!data) throw new AppError("NOT_FOUND");
  return pdfResponse(await renderStatement(data), request, { arabic: `كشف حساب - ${data.customer.name}`, ascii: "benuuprint-customer-statement" });
});
