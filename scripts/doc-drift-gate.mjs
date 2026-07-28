#!/usr/bin/env node
/**
 * Doc drift gate — machine-check the resolvable claims README.md makes about
 * the code, so they cannot silently rot.
 *
 * This exists because README.md advertised `v2.3.0-rc.5` as the active
 * development line while the root package.json had moved on to `2.5.0-rc.3`.
 * Nobody noticed for several release candidates: no check ever compared the two.
 *
 * Three claim classes are checked, each against a single source of truth:
 *
 *   version_drift   — a line starting with a bold version (`**v2.5.0-rc.3**`)
 *                     must match root package.json#version.
 *   unknown_command — every `` `fabric <word>` `` mention must resolve to a live
 *                     command, a documented retired name, or a quarantined one.
 *   unknown_event   — every `` `<domain>_<name>` `` event token must resolve to
 *                     an event_type declared in the shared event ledger schema.
 *
 * Prose that merely RECOUNTS history ("isolated in v2.0.0-rc.37") is not a claim
 * about the present, so only line-leading bold versions are checked — an inline
 * version is expected to differ from the current one.
 *
 * Run `--self-test` first (as `pnpm test:doc-drift` does) to prove the checker
 * still fails on a drifted input: a gate that cannot go red is not a gate.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

/** Files this gate scans. Deliberately just the front-door doc for now. */
const SCANNED_FILES = ["README.md"];

/**
 * `serve` was quarantined into packages/server-http-experimental rather than
 * deleted, so it is neither a live command nor a retired-name tombstone — yet
 * README legitimately mentions it (to say you do NOT need to run it).
 */
const QUARANTINED_COMMANDS = new Set(["serve"]);

/** Only these prefixes count as event tokens; other snake_case is config keys. */
const EVENT_TOKEN_RE = /`((?:knowledge|edit|cite|store|session)_[a-z_]+)`/gu;
const BOLD_VERSION_RE = /^\*\*v(\d+\.\d+\.\d+(?:-rc\.\d+)?)\*\*/u;
const COMMAND_MENTION_RE = /`fabric ([a-z][a-z0-9-]*)/gu;

function relativePath(filePath) {
  return path.relative(ROOT, filePath);
}

async function readRootVersion() {
  const manifestPath = path.join(ROOT, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${relativePath(manifestPath)} is missing a valid version.`);
  }
  return manifest.version;
}

/**
 * Parse the `allCommands` registry out of the CLI source with a regex instead of
 * importing it: the gate has to run in a few hundred ms on an unbuilt checkout
 * (same strategy as scripts/test-strategy-gate.mjs).
 */
async function readLiveCommands() {
  const filePath = path.join(ROOT, "packages/cli/src/commands/index.ts");
  const source = await readFile(filePath, "utf8");
  const start = source.indexOf("export const allCommands = {");
  if (start === -1) {
    throw new Error(`${relativePath(filePath)}: could not locate 'export const allCommands = {'.`);
  }
  const end = source.indexOf("\n};", start);
  if (end === -1) {
    throw new Error(`${relativePath(filePath)}: allCommands block is not terminated.`);
  }
  const block = source.slice(start, end);
  const names = new Set();
  for (const match of block.matchAll(/^\s{2}"?([a-z][a-z0-9-]*)"?:\s*\(\)\s*=>/gmu)) {
    names.add(match[1]);
  }
  // Fail loudly rather than degrade to an empty set: a silent parse miss would
  // turn every command mention into a false violation (or, if inverted, would
  // let real drift through).
  if (names.size === 0) {
    throw new Error(`${relativePath(filePath)}: parsed 0 commands out of allCommands.`);
  }
  return names;
}

/** Retired top-level names that README may still mention alongside a successor. */
async function readRetiredCommands() {
  const filePath = path.join(ROOT, "packages/cli/src/lib/command-signposts.ts");
  const source = await readFile(filePath, "utf8");
  const names = new Set();
  for (const match of source.matchAll(/retired:\s*"([a-z-]+)"/gu)) {
    names.add(match[1]);
  }
  if (names.size === 0) {
    throw new Error(`${relativePath(filePath)}: parsed 0 retired command signposts.`);
  }
  return names;
}

async function readEventTypes() {
  const filePath = path.join(ROOT, "packages/shared/src/schemas/event-ledger.ts");
  const source = await readFile(filePath, "utf8");
  const names = new Set();
  for (const match of source.matchAll(/event_type:\s*z\.literal\("([a-z_]+)"\)/gu)) {
    names.add(match[1]);
  }
  if (names.size === 0) {
    throw new Error(`${relativePath(filePath)}: parsed 0 event types.`);
  }
  return names;
}

/**
 * Pure checker over already-read lines. Split out from file IO so --self-test
 * can drive the exact same logic with a synthetic drifted document.
 */
export function checkLines(file, lines, truth) {
  const violations = [];
  const knownCommands = new Set([
    ...truth.liveCommands,
    ...truth.retiredCommands,
    ...QUARANTINED_COMMANDS,
  ]);

  lines.forEach((line, index) => {
    const lineNo = index + 1;

    const versionMatch = BOLD_VERSION_RE.exec(line);
    if (versionMatch !== null && versionMatch[1] !== truth.version) {
      violations.push({
        file,
        line: lineNo,
        code: "version_drift",
        message: `declares v${versionMatch[1]}, package.json is ${truth.version}`,
      });
    }

    for (const match of line.matchAll(COMMAND_MENTION_RE)) {
      if (!knownCommands.has(match[1])) {
        violations.push({
          file,
          line: lineNo,
          code: "unknown_command",
          message: `\`fabric ${match[1]}\` resolves to no live, retired, or quarantined command`,
        });
      }
    }

    for (const match of line.matchAll(EVENT_TOKEN_RE)) {
      if (!truth.eventTypes.has(match[1])) {
        violations.push({
          file,
          line: lineNo,
          code: "unknown_event",
          message: `\`${match[1]}\` is not an event_type in the shared event ledger schema`,
        });
      }
    }
  });

  return violations;
}

async function loadTruth() {
  const [version, liveCommands, retiredCommands, eventTypes] = await Promise.all([
    readRootVersion(),
    readLiveCommands(),
    readRetiredCommands(),
    readEventTypes(),
  ]);
  return { version, liveCommands, retiredCommands, eventTypes };
}

/**
 * Prove the checker still detects drift. Feeds a synthetic document carrying one
 * of each violation class and asserts all three are reported; then feeds a clean
 * document and asserts silence. Without this, a regression that made checkLines
 * return [] unconditionally would look exactly like a healthy repo.
 */
function selfTest(truth) {
  const drifted = [
    "**v0.0.1-rc.9** — stale active line claim",
    "Run `fabric notacommand --now` to do the thing.",
    "The hook writes a `knowledge_not_an_event` record.",
  ];
  const found = checkLines("<self-test>", drifted, truth);
  const codes = found.map((v) => v.code).sort();
  const expected = ["unknown_command", "unknown_event", "version_drift"];
  if (codes.join(",") !== expected.join(",")) {
    throw new Error(
      `self-test: expected [${expected.join(", ")}] on the drifted fixture, got [${codes.join(", ")}]`,
    );
  }
  if (found[0].line !== 1 || found[1].line !== 2 || found[2].line !== 3) {
    throw new Error("self-test: violations did not carry the drifted lines' numbers");
  }

  const clean = [
    `**v${truth.version}** — active development line`,
    "Run `fabric doctor` and `fabric serve` is not needed.",
    "The hook writes a `knowledge_body_read` record.",
    "Isolated back in v2.0.0-rc.37 — historical prose, not a live claim.",
  ];
  const noise = checkLines("<self-test>", clean, truth);
  if (noise.length !== 0) {
    throw new Error(
      `self-test: clean fixture produced ${noise.length} violation(s): ${JSON.stringify(noise)}`,
    );
  }

  process.stdout.write(
    "doc-drift-gate: self-test OK (drifted fixture reports version_drift + unknown_command + unknown_event; clean fixture is silent)\n",
  );
}

async function main() {
  const truth = await loadTruth();

  if (process.argv.includes("--self-test")) {
    selfTest(truth);
    return;
  }

  const violations = [];
  for (const relPath of SCANNED_FILES) {
    const source = await readFile(path.join(ROOT, relPath), "utf8");
    violations.push(...checkLines(relPath, source.split("\n"), truth));
  }

  if (violations.length === 0) {
    process.stdout.write(
      `doc-drift-gate: OK (${SCANNED_FILES.join(", ")}, version ${truth.version}, ${truth.liveCommands.size} commands, ${truth.eventTypes.size} events)\n`,
    );
    return;
  }

  for (const v of violations) {
    process.stdout.write(`${v.file}:${v.line}  ${v.code}  ${v.message}\n`);
  }
  process.stdout.write(`doc-drift-gate: ${violations.length} violation(s)\n`);
  process.exitCode = 1;
}

await main();
