import { apiOk, withApiHandler } from "@/lib/api/handler";
import { requireApiUser } from "@/lib/auth/current-user";
import { permissionsForRole } from "@/lib/auth/permissions";

/** The signed-in user and their permissions. 401 when not signed in. */
export const GET = withApiHandler(async () => {
  const user = await requireApiUser();
  return apiOk(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: permissionsForRole(user.role),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
