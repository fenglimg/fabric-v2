#!/usr/bin/env node
// Type-check gate for test files — the ones `pnpm typecheck` does NOT cover.
//
// Why this exists: all three packages ship the same tsconfig shape
// (`rootDir: ./src` + `include: ["src/**/*.ts"]`), there is no test-only
// tsconfig, and vitest does not run `typecheck`. Consequence, measured with a
// constructive probe (`const x: number = "…"` planted in both places):
//
//   packages/cli/__tests__/…        → tsc exits 0   (MISSED)
//   packages/server/src/services/…  → tsc exits 1   (caught, TS2322)
//
// So 197 test files (cli 144 + shared 45 + server 8) were never type-checked
// by anything. The first run of this gate immediately surfaced a dead contract
// field in banner-i18n.test.ts that no amount of green tests would reveal.
//
// Why a RATCHET and not a plain gate: the first run found 120 pre-existing
// errors across 29 files. Shipping that red would produce a gate nobody keeps
// green (the same reasoning lint-dangling-refs.mjs records for its own
// 1445-hit first cut). Shipping it as advisory would produce a gate nobody
// reads. So: every file NOT in the baseline must be clean, and a baselined
// file may only ever have FEWER errors than recorded. New test files are
// checked from day one; the existing debt can only shrink.
//
// To pay down debt: fix errors in a baselined file, then re-run with
// `--update-baseline` to lower its number. Raising a number is never legal —
// the script refuses and tells you to fix the code instead.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "typecheck-tests-baseline.json");
const PACKAGES = ["shared", "server", "cli"];
const UPDATE = process.argv.includes("--update-baseline");

/** Run tsc against a package's test config; return `Map<repoRelPath, errorCount>`. */
function checkPackage(pkg) {
  const cwd = join(ROOT, "packages", pkg);
  let output = "";
  try {
    // `pnpm exec`, not `npx` — npx resolves a decoy `tsc` package here.
    execFileSync("pnpm", ["exec", "tsc", "--noEmit", "-p", "tsconfig.test.json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // tsc exits non-zero when it reports errors; diagnostics land on stdout.
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  const counts = new Map();
  for (const line of output.split("\n")) {
    // `path/to/file.ts(12,34): error TS2322: …`
    const m = line.match(/^(.+?)\(\d+,\d+\): error TS\d+:/);
    if (!m) continue;
    // tsc prints paths relative to the package; normalise to repo-relative so
    // the baseline keys mean the same thing regardless of who runs it.
    const repoRel = relative(ROOT, resolve(cwd, m[1])).split("\\").join("/");
    counts.set(repoRel, (counts.get(repoRel) ?? 0) + 1);
  }
  return counts;
}

const actual = new Map();
for (const pkg of PACKAGES) {
  const cfg = join(ROOT, "packages", pkg, "tsconfig.test.json");
  if (!existsSync(cfg)) {
    console.error(`[typecheck-tests] FAIL — missing ${relative(ROOT, cfg)}`);
    process.exit(1);
  }
  for (const [file, n] of checkPackage(pkg)) actual.set(file, n);
}

if (UPDATE) {
  const next = Object.fromEntries([...actual].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  const total = [...actual.values()].reduce((a, b) => a + b, 0);
  console.log(
    `[typecheck-tests] baseline written — ${actual.size} files / ${total} errors.`,
  );
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : {};

const newlyBroken = []; // file not in baseline, now has errors
const regressed = []; // baselined file whose count went UP
const improved = []; // baselined file whose count went DOWN (nudge to update)

for (const [file, n] of actual) {
  const allowed = baseline[file];
  if (allowed === undefined) newlyBroken.push([file, n]);
  else if (n > allowed) regressed.push([file, allowed, n]);
  else if (n < allowed) improved.push([file, allowed, n]);
}
for (const [file, allowed] of Object.entries(baseline)) {
  if (!actual.has(file)) improved.push([file, allowed, 0]);
}

for (const [file, n] of newlyBroken) {
  console.error(`[typecheck-tests] NEW  ${file} — ${n} error(s), not in baseline`);
}
for (const [file, was, now] of regressed) {
  console.error(`[typecheck-tests] WORSE ${file} — ${was} → ${now}`);
}

if (newlyBroken.length || regressed.length) {
  console.error(
    "\n[typecheck-tests] FAIL — test files must type-check. Fix the errors;\n" +
      "do NOT silence them with `as any` (that is strictly worse than no gate)\n" +
      "and do NOT raise a baseline number — the baseline only ever goes down.",
  );
  process.exit(1);
}

const total = [...actual.values()].reduce((a, b) => a + b, 0);
const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(
  `[typecheck-tests] PASS — ${actual.size} file(s) with known debt, ${total} error(s) (baseline ${baseTotal}).`,
);
if (improved.length) {
  console.log(
    `[typecheck-tests] ${improved.length} file(s) improved — run with --update-baseline to lock the gain in.`,
  );
}
