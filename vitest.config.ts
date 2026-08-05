import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      AI_PROVIDER: "mock",
      NODE_ENV: "test",
      AUTH_SECRET: "test-secret-at-least-16-chars-long",
      DATABASE_URL: "postgresql://root@localhost:26257/recall?sslmode=disable",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
