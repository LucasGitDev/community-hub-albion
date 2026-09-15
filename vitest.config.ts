import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import swc from "unplugin-swc";
import quality from "./quality.config.json" with { type: "json" };

export default defineConfig({
  test: {
    projects: [
      {
        extends: false,
        resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
        test: { name: "default", include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"], exclude: ["apps/server/**", "**/node_modules/**"] },
      },
      {
        // Nest precisa de decorators + emitDecoratorMetadata, que oxc/esbuild não emitem: SWC só no server.
        plugins: [
          swc.vite({
            module: { type: "es6" },
            jsc: { target: "es2022", parser: { syntax: "typescript", decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } },
          }),
        ],
        test: { name: "server", include: ["apps/server/src/**/*.test.ts"] },
      },
    ],
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
