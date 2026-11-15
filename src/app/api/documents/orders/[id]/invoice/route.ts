import { withApiHandler } from "@/lib/api/handler";
import { requireApiUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { renderOrderInvoice } from "@/server/documents/customer-documents";
import { pdfResponse } from "@/server/documents/pdf-response";
import { getOrderInvoiceData } from "@/server/services/customer-documents-service";

/** GET /api/documents/orders/{id}/invoice[?download=1] — owner only. */
export const GET = withApiHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser("documents:customer-financial");
  const { id } = await context.params;
  const data = await getOrderInvoiceData(prisma, user, id);
  if (!data) throw new AppError("NOT_FOUND");
  const n = String(data.order.number).padStart(4, "0");
  return pdfResponse(await renderOrderInvoice(data), request, { arabic: `فاتورة أوردر ${n}`, ascii: `benuuprint-invoice-${n}` });
});
