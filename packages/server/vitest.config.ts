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
        // Test-only support code living under src/ so colocated *.test.ts
        // siblings can import it without crossing tsconfig `rootDir`. It is
        // never reachable from the tsup entry (src/index.ts) — excluding it
        // keeps it out of the 75% denominator like its *.test.ts consumers.
        "src/**/__testing__/**",
        "src/**/*.d.ts",
        "src/**/types*.ts",
        "src/**/types/**",
      ],
      thresholds: { lines: 75, statements: 75 },
    },
  },
});
