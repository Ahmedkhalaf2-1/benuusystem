import type { Role } from "@/generated/prisma/enums";

/** The signed-in user performing an operation. Services authorize against it. */
export type Actor = { id: string; role: Role; permissions: readonly string[] };
