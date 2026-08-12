import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * Generates every `templates/hooks/lib/*.cjs` that is compiled from shared TS.
 *
 * B8: the manifest used to hold a single entry (the ProjectContext runtime).
 * `theme` / `cite-line-parser` / `high-value-predicate` were hand-authored CJS
 * twins of the same-named shared modules, kept aligned by parity tests. Twins
 * drift silently between the moment the TS side changes and the moment someone
 * notices the parity bar is red — the high-value predicate already shipped such
 * a drift (hook counted 26 backlog sessions, server counted 1). Generating them
 * makes drift unrepresentable, so the parity tests were retired with the twins.
 *
 * Adding a module here is the whole job: drop it in the manifest, delete any
 * hand-written twin, and `hooks-runtime-generated.test.ts` will hold every
 * checked-in output byte-identical to a fresh build.
 */
const MANIFEST = [
  {
    out: "project-context-runtime",
    src: "../shared/src/resolver/hook-runtime-entry.ts",
    provenance: "packages/shared/src/resolver/hook-runtime-entry.ts",
  },
  {
    out: "theme",
    src: "../shared/src/theme.ts",
    provenance: "packages/shared/src/theme.ts",
  },
  {
    out: "cite-line-parser",
    src: "../shared/src/cite-line-parser.ts",
    provenance: "packages/shared/src/cite-line-parser.ts",
  },
  {
    out: "high-value-predicate",
    src: "../shared/src/high-value-predicate.ts",
    provenance: "packages/shared/src/high-value-predicate.ts",
  },
];

export const GENERATED_HOOK_LIBS = MANIFEST.map((entry) => `${entry.out}.cjs`);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const packageRoot = join(repoRoot, "packages", "cli");

function readOutDir(args) {
  const index = args.indexOf("--out-dir");
  if (index === -1) return join(packageRoot, "templates", "hooks", "lib");
  const value = args[index + 1];
  if (!value || args.length !== index + 2) {
    throw new Error("Usage: build-hook-project-context.mjs [--out-dir <directory>]");
  }
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

const outDir = readOutDir(process.argv.slice(2));

for (const entry of MANIFEST) {
  const banner = `// @generated from ${entry.provenance} by scripts/build-hook-project-context.mjs; DO NOT EDIT`;
  const result = spawnSync("pnpm", ["exec", "tsup", "--config", "tsup.hook-runtime.config.ts"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      FABRIC_HOOK_RUNTIME_OUT_DIR: outDir,
      FABRIC_HOOK_ENTRY_NAME: entry.out,
      FABRIC_HOOK_ENTRY_SRC: entry.src,
      FABRIC_HOOK_ENTRY_BANNER: banner,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  const outputPath = join(outDir, `${entry.out}.cjs`);
  if (!existsSync(outputPath)) {
    throw new Error(`Hook runtime build did not produce ${outputPath}`);
  }
  const generated = readFileSync(outputPath, "utf8");
  const bannerLine = `${banner}\n`;
  if (!generated.includes(bannerLine)) {
    throw new Error(`Hook runtime generated banner is missing from ${outputPath}`);
  }
  // esbuild may place the banner after its own prologue; hoist it so the first
  // line is always the DO-NOT-EDIT marker a human opening the file will see.
  const normalized = generated.startsWith(bannerLine)
    ? generated
    : `${bannerLine}${generated.replace(bannerLine, "")}`;
  if (normalized !== generated) writeFileSync(outputPath, normalized, "utf8");
  const firstLine = normalized.split(/\r?\n/, 1)[0];
  if (firstLine !== banner) {
    throw new Error(`Hook runtime header mismatch in ${outputPath}`);
  }
}
