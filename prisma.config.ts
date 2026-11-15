// Prisma CLI configuration (Prisma 7).
// Loads .env so `prisma migrate` / `prisma generate` work locally.
// In production, export DATABASE_URL in the environment instead.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Plain process.env (not env()) so `prisma generate` works without a database URL.
    url: process.env["DATABASE_URL"],
  },
});
