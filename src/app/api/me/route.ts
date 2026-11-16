import { apiOk, withApiHandler } from "@/lib/api/handler";
import { requireApiUser } from "@/lib/auth/current-user";
import { permissionsFor } from "@/lib/auth/permissions";

/** The signed-in user and their permissions. 401 when not signed in. */
export const GET = withApiHandler(async () => {
  const user = await requireApiUser();
  return apiOk(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: permissionsFor(user),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
