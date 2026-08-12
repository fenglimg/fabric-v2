import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

/**
 * Compiles ONE shared-TS module into the CJS form the hook runtime can
 * `require()`. Hooks run with no node_modules on their resolution path, so they
 * cannot import `@fenglimg/fabric-shared` — the module has to be bundled into a
 * standalone .cjs shipped inside `templates/hooks/lib/`.
 *
 * B8: this used to build only the ProjectContext runtime; the other hook libs
 * that mirror shared TS (theme / cite-line-parser / high-value-predicate) were
 * HAND-authored twins kept in step by parity tests. A twin that drifts is a
 * silent production bug — it already happened once, when the hook-side
 * high-value predicate counted 26 backlog sessions where the server counted 1 —
 * and a parity test only catches drift after someone remembers to write one.
 * Generating removes the failure mode instead of policing it.
 *
 * Parameterised by env so `scripts/build-hook-project-context.mjs` can drive one
 * entry per invocation and stamp each output with its own provenance banner.
 * The defaults reproduce the historical single-entry invocation verbatim.
 */
const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const outputDir = process.env.FABRIC_HOOK_RUNTIME_OUT_DIR ?? resolve(packageRoot, "templates/hooks/lib");
const runtimeOutputFile = "project-context-runtime.cjs";

const entryName = process.env.FABRIC_HOOK_ENTRY_NAME ?? runtimeOutputFile.slice(0, -".cjs".length);
const entrySource =
  process.env.FABRIC_HOOK_ENTRY_SRC ?? "../shared/src/resolver/hook-runtime-entry.ts";
const generatedBanner =
  process.env.FABRIC_HOOK_ENTRY_BANNER ??
  "// @generated from packages/shared/src/resolver/hook-runtime-entry.ts by scripts/build-hook-project-context.mjs; DO NOT EDIT";

export default defineConfig({
  entry: {
    [entryName]: resolve(packageRoot, entrySource),
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
