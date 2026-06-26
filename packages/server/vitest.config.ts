import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Global hermetic baseline: force the optional vector embedder unavailable
    // before every test (see vitest.setup.ts) so embed_enabled-default-true never
    // triggers a real model download (slow + non-deterministic) in rank tests.
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/**/types*.ts",
        "src/**/types/**",
      ],
      thresholds: { lines: 75, statements: 75 },
    },
  },
});
