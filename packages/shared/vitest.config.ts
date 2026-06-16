import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Windows fs/git ops run materially slower than POSIX; the default 5s
    // timeout flakes the property-based atomic-write + fs-heavy store tests on
    // the windows-smoke job. Raise the ceiling — fast tests still finish fast,
    // so Linux is unaffected; only genuinely slow Windows runs benefit.
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
      thresholds: { lines: 85, statements: 85 },
    },
  },
});
