import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import quality from "./quality.config.json" with { type: "json" };

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
  },
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Cobertura mede regra de negócio. UI é validada por e2e + verificação visual.
      include: quality.coverage.include,
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: { branches: quality.coverage.branches },
    },
  },
});
