import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: process.env.NODE_ENV === "production"
      ? "node dist-seed/prisma/seed.js"
      : "ts-node prisma/seed.ts",
  },
  datasource: {
    // Fallback to empty string during build — migrate deploy requires the real URL at runtime
    url: process.env.DATABASE_URL ?? "",
  },
});
