import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fenglimg/fabric-server": resolve(packageRoot, "../server/src/index.ts"),
      "@fenglimg/fabric-shared/node/atomic-write": resolve(packageRoot, "../shared/src/node/atomic-write.ts"),
      "@fenglimg/fabric-shared/node": resolve(packageRoot, "../shared/src/node.ts"),
      "@fenglimg/fabric-shared/i18n": resolve(packageRoot, "../shared/src/i18n/index.ts"),
      "@fenglimg/fabric-shared/errors": resolve(packageRoot, "../shared/src/errors/index.ts"),
      "@fenglimg/fabric-shared": resolve(packageRoot, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
