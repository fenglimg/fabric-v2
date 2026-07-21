import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const outputDir = process.env.FABRIC_HOOK_RUNTIME_OUT_DIR ?? resolve(packageRoot, "templates/hooks/lib");
const runtimeOutputFile = "project-context-runtime.cjs";
const generatedBanner =
  "// @generated from packages/shared/src/resolver/hook-runtime-entry.ts by scripts/build-hook-project-context.mjs; DO NOT EDIT";

export default defineConfig({
  entry: {
    [runtimeOutputFile.slice(0, -".cjs".length)]: resolve(
      packageRoot,
      "../shared/src/resolver/hook-runtime-entry.ts",
    ),
  },
  outDir: outputDir,
  outExtension: () => ({ js: ".cjs" }),
  format: ["cjs"],
  platform: "node",
  target: "node18",
  bundle: true,
  splitting: false,
  clean: false,
  minify: false,
  sourcemap: false,
  dts: false,
  treeshake: true,
  esbuildOptions(options) {
    options.banner = { js: generatedBanner };
  },
});
