import { apiOk, withApiHandler } from "@/lib/api/handler";
import { requireApiUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { parsePeriod } from "@/lib/reports/period";
import {
  getCashFlow,
  getExpenseReport,
  getFinancialOverview,
  getOrderContributions,
  getPayables,
  getReceivables,
  getWorkerObligations,
  listCashMovements,
  type MovementKind,
} from "@/server/services/reports-service";

const KINDS = ["customer", "cost", "expense", "wage", "advance", "in", "out"] as const;

/**
 * Owner-only, read-only financial reports:
 *   GET /api/reports/{overview|cash-flow|movements|receivables|payables|workers|orders|expenses}
 * Query: period=this|last|custom (&from&to), q, kind, page, overdue=1, sort=amount|due, status.
 * The permission is checked here AND again inside every service call.
 */
export const GET = withApiHandler(async (request: Request, context: { params: Promise<{ report: string }> }) => {
  const user = await requireApiUser("finance:view-summary");
  const { report } = await context.params;
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const range = parsePeriod(sp);
  const q = (sp.q ?? "").slice(0, 100);
  const headers = { headers: { "Cache-Control": "no-store" } };
  switch (report) {
    case "overview":
      return apiOk(await getFinancialOverview(prisma, user, range), headers);
    case "cash-flow":
      return apiOk(await getCashFlow(prisma, user, range), headers);
    case "movements": {
      const kind = (KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as MovementKind | "in" | "out") : undefined;
      return apiOk(await listCashMovements(prisma, user, { range, kind, q, page: Number(sp.page) || 1 }), headers);
    }
    case "receivables":
      return apiOk(await getReceivables(prisma, user, { q, overdueOnly: sp.overdue === "1", sort: sp.sort === "due" ? "due" : "amount" }), headers);
    case "payables":
      return apiOk(await getPayables(prisma, user, { q }), headers);
    case "workers":
      return apiOk(await getWorkerObligations(prisma, user), headers);
    case "orders": {
      const status = sp.status === "open" || sp.status === "completed" ? sp.status : "all";
      return apiOk(await getOrderContributions(prisma, user, { range: sp.period ? range : undefined, status, q: q || undefined }), headers);
    }
    case "expenses":
      return apiOk(await getExpenseReport(prisma, user, range), headers);
    default:
      throw new AppError("NOT_FOUND");
  }
});
