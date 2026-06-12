import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
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
      "@fenglimg/fabric-shared": resolve(packageRoot, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
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
      thresholds: { lines: 70, statements: 70 },
    },
  },
});
