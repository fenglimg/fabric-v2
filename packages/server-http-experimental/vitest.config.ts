import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fenglimg/fabric-server": resolve(packageRoot, "../server/src/index.ts"),
      "@fenglimg/fabric-shared/errors": resolve(packageRoot, "../shared/src/errors/index.ts"),
      "@fenglimg/fabric-shared/node": resolve(packageRoot, "../shared/src/node.ts"),
      "@fenglimg/fabric-shared/node/mcp-payload-guard": resolve(
        packageRoot,
        "../shared/src/node/mcp-payload-guard.ts",
      ),
      "@fenglimg/fabric-shared/schemas/api-contracts": resolve(
        packageRoot,
        "../shared/src/schemas/api-contracts.ts",
      ),
      "@fenglimg/fabric-shared": resolve(packageRoot, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
