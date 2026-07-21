import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const GENERATED_HEADER =
  "// @generated from packages/shared/src/resolver/hook-runtime-entry.ts by scripts/build-hook-project-context.mjs; DO NOT EDIT";
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
const result = spawnSync(
  "pnpm",
  ["exec", "tsup", "--config", "tsup.hook-runtime.config.ts"],
  {
    cwd: packageRoot,
    env: { ...process.env, FABRIC_HOOK_RUNTIME_OUT_DIR: outDir },
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const outputPath = join(outDir, "project-context-runtime.cjs");
if (!existsSync(outputPath)) {
  throw new Error(`Hook runtime build did not produce ${outputPath}`);
}
const generated = readFileSync(outputPath, "utf8");
const bannerLine = `${GENERATED_HEADER}\n`;
if (!generated.includes(bannerLine)) {
  throw new Error(`Hook runtime generated banner is missing from ${outputPath}`);
}
const normalized = generated.startsWith(bannerLine)
  ? generated
  : `${bannerLine}${generated.replace(bannerLine, "")}`;
if (normalized !== generated) writeFileSync(outputPath, normalized, "utf8");
const firstLine = normalized.split(/\r?\n/, 1)[0];
if (firstLine !== GENERATED_HEADER) {
  throw new Error(`Hook runtime header mismatch in ${outputPath}`);
}
