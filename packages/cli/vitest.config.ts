import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Mirror tsup.config.ts's build-time define so tests that import src/index.ts
  // (the CLI entrypoint) resolve __CLI_VERSION__ instead of throwing ReferenceError.
  define: { __CLI_VERSION__: JSON.stringify("0.0.0-test") },
  resolve: {
    alias: {
      "@fenglimg/fabric-server": resolve(packageRoot, "../server/src/index.ts"),
      "@fenglimg/fabric-shared/node/atomic-write": resolve(packageRoot, "../shared/src/node/atomic-write.ts"),
      "@fenglimg/fabric-shared/node/mcp-payload-guard": resolve(packageRoot, "../shared/src/node/mcp-payload-guard.ts"),
      "@fenglimg/fabric-shared/node": resolve(packageRoot, "../shared/src/node.ts"),
      "@fenglimg/fabric-shared/i18n": resolve(packageRoot, "../shared/src/i18n/index.ts"),
      "@fenglimg/fabric-shared/errors": resolve(packageRoot, "../shared/src/errors/index.ts"),
      "@fenglimg/fabric-shared/schemas/api-contracts": resolve(packageRoot, "../shared/src/schemas/api-contracts.ts"),
      "@fenglimg/fabric-shared/templates/bootstrap-canonical": resolve(packageRoot, "../shared/src/templates/bootstrap-canonical.ts"),
      "@fenglimg/fabric-shared/theme": resolve(packageRoot, "../shared/src/theme.ts"),
      "@fenglimg/fabric-shared": resolve(packageRoot, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // The install/uninstall integration suites each do a real ~93-file bootstrap
    // write, so one test can spend most of a second in the filesystem. Under
    // file-parallelism every core runs one such suite at once and each test slows
    // by roughly 5x through CPU/IO contention, pushing the heaviest ones just past
    // vitest’s 5s default. That produced ~31 failures which looked
    // non-deterministic but were plain timeouts, not the rename() race an earlier
    // revision of this comment blamed: the integration directory run
    // parallel-but-alone is green, and the full suite is green on three
    // consecutive parallel runs once the budget fits the contended timings.
    // Serialising cost ~2x wall (103s → 47s) and hid the real cause, so the budget
    // is raised instead and no assertion is weakened.
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
      thresholds: { lines: 70, statements: 70 },
    },
  },
});
