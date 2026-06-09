import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { defineCommand } from "citty";

import {
  buildStoreResolveInput,
  createStoreResolver,
  ONBOARD_SLOT_NAMES,
  ONBOARD_SLOT_TOTAL,
  readKnowledgeAcrossStores,
  resolveGlobalRoot,
  storeRelativePath,
  type MountedStoreDir,
  type OnboardSlot,
} from "@fenglimg/fabric-shared";

import { t } from "../i18n.js";

// ---------------------------------------------------------------------------
// v2.0.0-rc.23 TASK-014 (F8c) — `fabric onboard-coverage`
//
// Walks mounted stores in the current project's read-set
// (`~/.fabric/stores/<uuid>/knowledge/{decisions,pitfalls,guidelines,models,processes}/*.md`,
// canonical only — pending/ ignored, since the slot only counts once the
// entry has been approved and lives at a stable id), parses each file's YAML
// frontmatter for an `onboard_slot:` line, and aggregates which of the five
// fixed S5 slot labels have been claimed.
//
// Output:
//   {
//     filled:    Record<slot, stable_ids[]>   // slots covered by ≥1 entry
//     missing:   slot[]                         // slot names not yet covered
//                                              //   and not opted-out
//     opted_out: slot[]                         // user-dismissed slots
//     total:     5                              // == ONBOARD_SLOT_TOTAL
//   }
//
// The `--json` flag emits exactly that payload to stdout (one line, newline
// terminated). The default (no flag) emits a human-readable table for
// terminal review.
//
// Used by:
//   * the `fabric-archive` Skill's first-run onboard phase (TASK-014 F8c)
//   * the server-side `doctor.ts` Onboard coverage advisory
//     (mirrors the same scanner via runOnboardCoverage so a single rule
//     governs both surfaces)
// ---------------------------------------------------------------------------

const KNOWLEDGE_TYPE_DIRS = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
] as const;

const FABRIC_CONFIG_PATH = [".fabric", "fabric-config.json"] as const;

export interface OnboardCoverageReport {
  filled: Record<OnboardSlot, string[]>;
  missing: OnboardSlot[];
  opted_out: string[];
  total: number;
}

/**
 * Build an empty coverage skeleton with every S5 slot pre-populated as an
 * empty `stable_ids` list. Returning a fully-shaped object keeps downstream
 * type-narrowing predictable — consumers can read `report.filled[slot]`
 * without nil-checking.
 */
function emptyFilled(): Record<OnboardSlot, string[]> {
  const filled = {} as Record<OnboardSlot, string[]>;
  for (const slot of ONBOARD_SLOT_NAMES) {
    filled[slot] = [];
  }
  return filled;
}

/**
 * Read frontmatter scalar `onboard_slot:` if present. Returns the bare value
 * (whitespace-trimmed, surrounding double-quotes stripped if any) or
 * `undefined` when the key is absent OR the file has no frontmatter block.
 *
 * Intentional minimalism: we hand-roll the parser instead of pulling in a
 * full YAML lib to keep the CLI command dep-free. This mirrors the
 * `readFrontmatterKey` helper inside extract-knowledge.ts but is duplicated
 * here so the CLI package doesn't transitively depend on @fenglimg/fabric-server
 * (which would inflate the install footprint).
 */
function readOnboardSlotFrontmatter(filePath: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  const match = /^---\n([\s\S]*?)\n---/u.exec(content);
  if (match === null) return undefined;
  const block = match[1];
  if (block === undefined) return undefined;
  for (const rawLine of block.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    if (key !== "onboard_slot") continue;
    let value = line.slice(sep + 1).trim();
    // Strip optional surrounding double-quotes (writer emits bare scalar but
    // a future human-edited entry might quote it — accept both shapes).
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

/**
 * Read frontmatter `id:` so coverage can report which canonical entries
 * claimed each slot. Falls back to the bare filename (without `.md`) when
 * the `id:` line is absent, which matches how downstream tooling stringifies
 * pre-id entries.
 */
function readStableIdFrontmatter(filePath: string, fallbackName: string): string {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return fallbackName.replace(/\.md$/u, "");
  }
  const match = /^---\n([\s\S]*?)\n---/u.exec(content);
  if (match === null) return fallbackName.replace(/\.md$/u, "");
  const block = match[1];
  if (block === undefined) return fallbackName.replace(/\.md$/u, "");
  for (const rawLine of block.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    if (line.slice(0, sep).trim() !== "id") continue;
    return line.slice(sep + 1).trim();
  }
  return fallbackName.replace(/\.md$/u, "");
}

/**
 * Read `.fabric/fabric-config.json`'s `onboard_slots_opted_out` array. Tolerant
 * to a missing config (returns `[]`) and malformed JSON (logs to stderr and
 * returns `[]`) — neither case should crash the coverage scan.
 */
function readOptedOutSlots(projectRoot: string): string[] {
  const path = join(projectRoot, ...FABRIC_CONFIG_PATH);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `onboard-coverage: ignoring malformed fabric-config.json (${err instanceof Error ? err.message : String(err)})\n`,
    );
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const slots = (parsed as Record<string, unknown>).onboard_slots_opted_out;
  if (!Array.isArray(slots)) return [];
  return slots.filter((v): v is string => typeof v === "string");
}

function readSetStoreDirs(projectRoot: string): MountedStoreDir[] {
  let input: ReturnType<typeof buildStoreResolveInput>;
  try {
    input = buildStoreResolveInput(projectRoot);
  } catch {
    return [];
  }
  if (input === null) {
    return [];
  }
  const readSet = createStoreResolver().resolveReadSet(input);
  const globalRoot = resolveGlobalRoot();
  return readSet.stores.map((store) => ({
    store_uuid: store.store_uuid,
    alias: store.alias,
    dir: join(globalRoot, storeRelativePath(store.store_uuid)),
  }));
}

function entryName(filePath: string): string {
  return filePath.split(/[\\/]/u).at(-1) ?? filePath;
}

function listLegacyProjectKnowledge(projectRoot: string): Array<MountedStoreDir & { file: string; type: string }> {
  const refs: Array<MountedStoreDir & { file: string; type: string }> = [];
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  for (const type of KNOWLEDGE_TYPE_DIRS) {
    const dir = join(knowledgeRoot, type);
    if (!existsSync(dir)) continue;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
      refs.push({
        store_uuid: "project-local",
        alias: "",
        dir: join(projectRoot, ".fabric"),
        type,
        file: join(dir, name),
      });
    }
  }
  return refs;
}

/**
 * Pure handler — exported for unit tests and for the server-side doctor
 * Onboard coverage advisory.
 */
export async function runOnboardCoverage(projectRoot: string): Promise<OnboardCoverageReport> {
  const filled = emptyFilled();
  const readSetRefs = await readKnowledgeAcrossStores(readSetStoreDirs(projectRoot));
  const refs = [...readSetRefs, ...listLegacyProjectKnowledge(projectRoot)];
  for (const ref of refs) {
    if (!(KNOWLEDGE_TYPE_DIRS as readonly string[]).includes(ref.type)) continue;
    const slot = readOnboardSlotFrontmatter(ref.file);
    if (slot === undefined) continue;
    // Only accept slot values that match the locked S5 set. Off-spec values are
    // silently ignored — they neither fill nor count toward missing.
    if (!(ONBOARD_SLOT_NAMES as readonly string[]).includes(slot)) continue;
    const stableId = readStableIdFrontmatter(ref.file, entryName(ref.file));
    filled[slot as OnboardSlot].push(ref.alias.length === 0 ? stableId : `${ref.alias}:${stableId}`);
  }

  const optedOut = readOptedOutSlots(projectRoot);
  // Stable insertion order = ONBOARD_SLOT_NAMES order. A slot is missing iff
  // it is NOT filled AND NOT opted-out.
  const missing: OnboardSlot[] = ONBOARD_SLOT_NAMES.filter((slot) => {
    if (filled[slot].length > 0) return false;
    if (optedOut.includes(slot)) return false;
    return true;
  });

  // Stable sort within each filled[slot] for reproducible JSON output.
  for (const slot of ONBOARD_SLOT_NAMES) {
    filled[slot].sort();
  }

  return {
    filled,
    missing,
    opted_out: optedOut,
    total: ONBOARD_SLOT_TOTAL,
  };
}

/**
 * Render the human-readable table view. One row per S5 slot, status column
 * marks `filled`/`opted-out`/`missing`. Used when `--json` is omitted.
 */
function renderHumanReadable(report: OnboardCoverageReport): string {
  const filledCount = ONBOARD_SLOT_NAMES.filter(
    (slot) => report.filled[slot].length > 0,
  ).length;
  const optedOutCount = report.opted_out.length;
  const missingCount = report.missing.length;

  const lines: string[] = [];
  lines.push(
    `Onboard coverage: ${filledCount}/${report.total} filled, ${optedOutCount} opted-out, ${missingCount} missing`,
  );
  lines.push("");
  lines.push("  slot                       status      entries");
  lines.push("  -------------------------- ----------- -------------------------");
  for (const slot of ONBOARD_SLOT_NAMES) {
    const entries = report.filled[slot];
    let status: string;
    let detail: string;
    if (entries.length > 0) {
      status = "filled";
      detail = entries.join(", ");
    } else if (report.opted_out.includes(slot)) {
      status = "opted-out";
      detail = "(user-dismissed; run `fabric config onboard-reset` to re-open)";
    } else {
      status = "missing";
      detail = "(run /fabric-archive to onboard)";
    }
    lines.push(`  ${slot.padEnd(26)} ${status.padEnd(11)} ${detail}`);
  }
  return lines.join("\n");
}

interface OnboardCoverageArgs {
  json?: boolean;
  target?: string;
}

export const onboardCoverageCommand = defineCommand({
  meta: {
    name: "onboard-coverage",
    // v2.0.0-rc.29 TASK-008 (BUG-L2): route description strings through t()
    // (mirrors serve.ts pattern). Previously this command was English-only
    // even when the rest of `fabric --help` rendered zh-CN, so Chinese-locale
    // users saw an isolated English block under --help.
    description: t("cli.onboard-coverage.description"),
    // Mirrors `plan-context-hint`: hidden from `fabric --help` so the top-level
    // banner stays focused on install/doctor/serve/config. The command stays
    // callable directly from Skills via `fabric onboard-coverage --json`.
    hidden: true,
  },
  args: {
    json: {
      type: "boolean",
      description: t("cli.onboard-coverage.args.json.description"),
      default: false,
    },
    target: {
      type: "string",
      description: t("cli.onboard-coverage.args.target.description"),
    },
  },
  async run({ args }: { args: OnboardCoverageArgs }) {
    try {
      const projectRoot = resolve(args.target ?? process.cwd());
      const report = await runOnboardCoverage(projectRoot);
      if (args.json === true) {
        process.stdout.write(`${JSON.stringify(report)}\n`);
      } else {
        process.stdout.write(`${renderHumanReadable(report)}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`onboard-coverage failed: ${message}\n`);
      process.exitCode = 1;
    }
  },
});

export default onboardCoverageCommand;
