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
    // Run test FILES serially. The install/uninstall/clone integration suites do
    // real bootstrap writes (~93 hook/skill files each via atomic temp-file +
    // rename). Under high file-parallelism (many-core dev boxes spawn one fork
    // per core, each running a full 93-file install at once), those concurrent
    // rename() syscalls sporadically race the OS filesystem — ENOENT on the .tmp
    // source mid-rename → `install errors=1` → an incomplete tree → flaky
    // byte-exact assertions (30+ non-deterministic failures locally, all green
    // serially). Production never runs 14 installs at once, so this is a
    // test-load artifact, not a product bug; serial file execution makes the
    // suite deterministic on any core count without weakening a single assertion.
    fileParallelism: false,
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
