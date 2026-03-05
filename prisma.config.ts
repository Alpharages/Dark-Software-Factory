import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node dist-seed/prisma/seed.js",
  },
  datasource: {
    // Fallback to empty string during build — migrate deploy requires the real URL at runtime
    url: process.env.DATABASE_URL ?? "",
  },
});
