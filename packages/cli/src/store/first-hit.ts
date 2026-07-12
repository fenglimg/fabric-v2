import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  allocateStoreKnowledgeId,
  buildStoreResolveInput,
  createStoreResolver,
  listStoreKnowledge,
  resolveGlobalRoot,
  storeRelativePathForMount,
  STORE_LAYOUT,
  type MountedStoreDir,
} from "@fenglimg/fabric-shared";

import { loadProjectConfig } from "./project-config-io.js";
import { loadGlobalConfig } from "./global-config-io.js";

// ---------------------------------------------------------------------------
// First-hit oracle (M-first-value-loop)
//
// Proves install → bind → non-empty knowledge surface readiness without a live
// LLM session. Fail-loud codes (exit_code for scripts/CI):
//   unbound / no_write_target / empty_store / hooks_missing / no_match / ok
// ---------------------------------------------------------------------------

export type FirstHitCode =
  | "ok"
  | "unbound"
  | "no_write_target"
  | "empty_store"
  | "no_match"
  | "hooks_missing"
  | "no_project"
  | "no_global";

export interface FirstHitStoreRow {
  alias: string;
  entry_count: number;
  sample_ids: string[];
}

export interface FirstHitHooks {
  session_start: boolean;
  pre_tool_use: boolean;
  paths_checked: string[];
}

export interface FirstHitReport {
  code: FirstHitCode;
  ok: boolean;
  exit_code: number;
  message: string;
  remediations: string[];
  bound_stores: FirstHitStoreRow[];
  total_entries: number;
  hooks: FirstHitHooks;
  write_target: string | null;
  project_root: string;
}

export interface AssessFirstHitOptions {
  projectRoot: string;
  globalRoot?: string;
  probePath?: string;
}

function resolveMountedDirs(
  projectRoot: string,
  globalRoot: string,
): Array<{ alias: string; store_uuid: string; dir: string }> {
  // buildStoreResolveInput(projectRoot, globalRoot) — second arg is path string.
  const input = buildStoreResolveInput(projectRoot, globalRoot);
  if (input === null) {
    return [];
  }
  const readSet = createStoreResolver().resolveReadSet(input);
  if (readSet.stores.length === 0) {
    return [];
  }
  return readSet.stores.map((entry) => {
    const mounted =
      input.mountedStores.find((s) => s.store_uuid === entry.store_uuid) ?? {
        store_uuid: entry.store_uuid,
      };
    return {
      alias: entry.alias,
      store_uuid: entry.store_uuid,
      dir: join(globalRoot, storeRelativePathForMount(mounted)),
    };
  });
}

async function countStoreEntries(
  rows: Array<{ alias: string; store_uuid: string; dir: string }>,
): Promise<FirstHitStoreRow[]> {
  const out: FirstHitStoreRow[] = [];
  for (const row of rows) {
    if (!existsSync(row.dir)) {
      out.push({ alias: row.alias, entry_count: 0, sample_ids: [] });
      continue;
    }
    const store: MountedStoreDir = {
      dir: row.dir,
      alias: row.alias,
      store_uuid: row.store_uuid,
    };
    const entries = await listStoreKnowledge(store);
    const canonical = entries.filter((e) => e.type !== "pending");
    out.push({
      alias: row.alias,
      entry_count: canonical.length,
      // StoreKnowledgeRef has absolute `file`; derive a short id from basename.
      sample_ids: canonical.slice(0, 5).map((e) => {
        const base = e.file.split(/[\\/]/u).pop() ?? e.file;
        return base.replace(/\.md$/u, "").split("--")[0] ?? base;
      }),
    });
  }
  return out;
}

function detectHooks(projectRoot: string): FirstHitHooks {
  const candidates = [
    {
      session: join(projectRoot, ".claude", "hooks", "knowledge-hint-broad.cjs"),
      pre: join(projectRoot, ".claude", "hooks", "knowledge-pretooluse.cjs"),
    },
    {
      session: join(projectRoot, ".codex", "hooks", "knowledge-hint-broad.cjs"),
      pre: join(projectRoot, ".codex", "hooks", "knowledge-pretooluse.cjs"),
    },
  ];
  const paths_checked: string[] = [];
  let session_start = false;
  let pre_tool_use = false;
  for (const c of candidates) {
    paths_checked.push(c.session, c.pre);
    if (existsSync(c.session)) session_start = true;
    if (existsSync(c.pre)) pre_tool_use = true;
  }
  return { session_start, pre_tool_use, paths_checked };
}

function remediationFor(code: FirstHitCode, writeTarget: string | null): string[] {
  switch (code) {
    case "no_global":
      return ["fabric install --global", "fabric install"];
    case "no_project":
      return ["fabric install", "fabric store bind <alias>", "fabric store switch-write <alias>"];
    case "unbound":
      return [
        "fabric store list",
        "fabric store bind <alias>",
        "fabric store switch-write <alias>",
        "fabric first-hit",
      ];
    case "no_write_target":
      return [
        "fabric store switch-write <alias>",
        "or re-run: fabric install",
        "fabric first-hit",
      ];
    case "empty_store":
      return [
        "fabric first-hit --seed",
        writeTarget ? `(write target: ${writeTarget})` : "bind a store with knowledge first",
        "or: fabric store bind <remote-team-store-with-content>",
        "fabric first-hit",
      ];
    case "hooks_missing":
      return ["fabric install", "fabric first-hit"];
    case "no_match":
      return [
        "fabric preview",
        "fabric plan-context-hint --all",
        "edit a path under relevance_paths, or seed a broad guideline",
      ];
    case "ok":
      return [];
    default:
      return ["fabric doctor", "fabric first-hit"];
  }
}

function messageFor(code: FirstHitCode, total: number, stores: FirstHitStoreRow[]): string {
  switch (code) {
    case "ok":
      return `first-hit ready: ${total} knowledge entr${total === 1 ? "y" : "ies"} across ${stores.length} store(s); hooks present.`;
    case "unbound":
      return "unbound: no store is bound to this project's read-set — knowledge cannot surface.";
    case "no_write_target":
      return "no_write_target: project has required stores but no active_write_store.";
    case "empty_store":
      return "empty_store: store(s) bound but 0 canonical knowledge files — empty store is not a happy path.";
    case "no_match":
      return "no_match: knowledge exists but the probe surface is empty (path/scope filter).";
    case "hooks_missing":
      return "hooks_missing: knowledge is present but SessionStart/PreToolUse hooks are not installed.";
    case "no_project":
      return "no_project: this directory is not a Fabric project (missing .fabric/fabric-config.json).";
    case "no_global":
      return "no_global: fabric global config missing — run fabric install --global first.";
    default:
      return String(code);
  }
}

function exitFor(code: FirstHitCode): number {
  switch (code) {
    case "ok":
      return 0;
    case "unbound":
    case "no_write_target":
    case "no_project":
    case "no_global":
      return 2;
    case "empty_store":
      return 3;
    case "hooks_missing":
      return 4;
    case "no_match":
      return 5;
    default:
      return 1;
  }
}

/** Assess whether this project can prove first-hit readiness. */
export async function assessFirstHit(options: AssessFirstHitOptions): Promise<FirstHitReport> {
  const projectRoot = options.projectRoot;
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const hooks = detectHooks(projectRoot);
  const project = loadProjectConfig(projectRoot);
  const global = loadGlobalConfig(globalRoot);
  const write_target =
    typeof project?.active_write_store === "string" && project.active_write_store.length > 0
      ? project.active_write_store
      : null;

  const fail = (
    code: FirstHitCode,
    bound_stores: FirstHitStoreRow[] = [],
    total_entries = 0,
  ): FirstHitReport => ({
    code,
    ok: false,
    exit_code: exitFor(code),
    message: messageFor(code, total_entries, bound_stores),
    remediations: remediationFor(code, write_target),
    bound_stores,
    total_entries,
    hooks,
    write_target,
    project_root: projectRoot,
  });

  if (global === null) return fail("no_global");
  if (project === null) return fail("no_project");

  const required = (project.required_stores ?? []).map((r) => r.id);
  const dirs = resolveMountedDirs(projectRoot, globalRoot);

  if (dirs.length === 0 && required.length === 0 && write_target === null) {
    return fail("unbound");
  }
  if (dirs.length === 0) {
    return fail("unbound");
  }

  const bound_stores = await countStoreEntries(dirs);
  const total_entries = bound_stores.reduce((n, s) => n + s.entry_count, 0);

  if (write_target === null) {
    return fail("no_write_target", bound_stores, total_entries);
  }

  if (total_entries === 0) {
    return fail("empty_store", bound_stores, 0);
  }

  if (!hooks.session_start || !hooks.pre_tool_use) {
    return fail("hooks_missing", bound_stores, total_entries);
  }

  if (
    options.probePath &&
    total_entries > 0 &&
    bound_stores.every((s) => s.sample_ids.length === 0)
  ) {
    return fail("no_match", bound_stores, total_entries);
  }

  return {
    code: "ok",
    ok: true,
    exit_code: 0,
    message: messageFor("ok", total_entries, bound_stores),
    remediations: [],
    bound_stores,
    total_entries,
    hooks,
    write_target,
    project_root: projectRoot,
  };
}

/** Sync-friendly wrapper for doctor (never throws). */
export function assessFirstHitSync(
  projectRoot: string,
  options: { globalRoot?: string } = {},
): FirstHitReport {
  // Doctor path: de-async by using filesystem counts only (no listStoreKnowledge).
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const hooks = detectHooks(projectRoot);
  const project = loadProjectConfig(projectRoot);
  const global = loadGlobalConfig(globalRoot);
  const write_target =
    typeof project?.active_write_store === "string" && project.active_write_store.length > 0
      ? project.active_write_store
      : null;

  const fail = (code: FirstHitCode, bound_stores: FirstHitStoreRow[] = [], total = 0): FirstHitReport => ({
    code,
    ok: false,
    exit_code: exitFor(code),
    message: messageFor(code, total, bound_stores),
    remediations: remediationFor(code, write_target),
    bound_stores,
    total_entries: total,
    hooks,
    write_target,
    project_root: projectRoot,
  });

  // Prefer project-missing over global-missing when the global root is empty
  // but the caller is clearly in a non-project dir (both missing → no_global).
  if (project === null && global === null) return fail("no_global");
  if (project === null) return fail("no_project");
  if (global === null) return fail("no_global");

  let dirs: Array<{ alias: string; store_uuid: string; dir: string }> = [];
  try {
    dirs = resolveMountedDirs(projectRoot, globalRoot);
  } catch {
    return fail("unbound");
  }
  if (dirs.length === 0) return fail("unbound");

  const bound_stores: FirstHitStoreRow[] = dirs.map((d) => {
    const n = countKnowledgeMarkdown(d.dir);
    return { alias: d.alias, entry_count: n, sample_ids: n > 0 ? ["(present)"] : [] };
  });
  const total = bound_stores.reduce((a, s) => a + s.entry_count, 0);
  if (write_target === null) return fail("no_write_target", bound_stores, total);
  if (total === 0) return fail("empty_store", bound_stores, 0);
  if (!hooks.session_start || !hooks.pre_tool_use) {
    return fail("hooks_missing", bound_stores, total);
  }
  return {
    code: "ok",
    ok: true,
    exit_code: 0,
    message: messageFor("ok", total, bound_stores),
    remediations: [],
    bound_stores,
    total_entries: total,
    hooks,
    write_target,
    project_root: projectRoot,
  };
}

const STARTER_GUIDELINE_BODY = `---
id: {{id}}
type: guidelines
layer: {{layer}}
maturity: draft
relevance_scope: broad
summary: Fabric first-hit starter — open a new AI session after install; SessionStart should list this guideline.
tags:
  - first-hit
  - onboarding
created_at: {{created}}
---

# First-hit starter guideline

This entry is a **seed** so an empty store is never a silent happy path.

## When it surfaces

- **SessionStart (broad)** — always-active guideline index line
- **fab_recall** on any path in this repo

## What to do next

1. Open a new Claude Code / Codex session in this project
2. Confirm SessionStart shows Fabric knowledge lines
3. Run \`fabric first-hit\` anytime to re-prove readiness
4. Review / promote this draft via \`/fabric-review\` when ready
`;

const STARTER_PITFALL_BODY = `---
id: {{id}}
type: pitfalls
layer: {{layer}}
maturity: draft
relevance_scope: narrow
relevance_paths:
  - "packages/**"
  - "src/**"
  - ".fabric/**"
  - "docs/USER-QUICKSTART.md"
summary: Empty bound store is not ready — seed or bind a store with knowledge before expecting SessionStart hits.
must_read_if: debugging why Fabric installed but nothing surfaces after bind
tags:
  - first-hit
  - empty-store
created_at: {{created}}
---

# Empty store is not first-hit ready

## Symptom

\`fabric install\` + bind succeeded, but SessionStart is empty and \`fabric first-hit\` exits with \`empty_store\`.

## Fix

\`\`\`bash
fabric first-hit --seed
# or bind a remote team store that already has knowledge
fabric store bind <alias>
fabric first-hit
\`\`\`
`;

/**
 * Seed 2 starter knowledge files into a store directory (empty-store recovery).
 * Only call for local empty / newly created stores — never bulk-seed shared team stores.
 */
export async function seedStarterKnowledge(
  storeDir: string,
  options: { layer?: "team" | "personal"; now?: string; force?: boolean } = {},
): Promise<{ seeded: boolean; ids: string[]; files: string[]; reason?: string }> {
  const existing = countKnowledgeMarkdown(storeDir);
  if (existing > 0 && options.force !== true) {
    return { seeded: false, ids: [], files: [], reason: "store not empty" };
  }

  const layer = options.layer ?? "team";
  const created = options.now ?? new Date().toISOString().slice(0, 10);
  const ids: string[] = [];
  const files: string[] = [];

  const guidelineId = await allocateStoreKnowledgeId(layer, "guidelines", storeDir);
  const pitfallId = await allocateStoreKnowledgeId(layer, "pitfalls", storeDir);

  const writeEntry = (typeDir: string, id: string, template: string) => {
    const dir = join(storeDir, STORE_LAYOUT.knowledgeDir, typeDir);
    mkdirSync(dir, { recursive: true });
    const slug = id.toLowerCase().replace(/[^a-z0-9]+/giu, "-");
    const file = join(dir, `${id}--${slug}.md`);
    const body = template
      .replaceAll("{{id}}", id)
      .replaceAll("{{layer}}", layer)
      .replaceAll("{{created}}", created);
    writeFileSync(file, body, "utf8");
    files.push(file);
    ids.push(id);
  };

  writeEntry("guidelines", guidelineId, STARTER_GUIDELINE_BODY);
  writeEntry("pitfalls", pitfallId, STARTER_PITFALL_BODY);

  return { seeded: true, ids, files };
}

export function resolveStoreDirForAlias(
  alias: string,
  globalRoot: string = resolveGlobalRoot(),
): string | null {
  const global = loadGlobalConfig(globalRoot);
  if (global === null) return null;
  const store = global.stores.find((s) => s.alias === alias);
  if (store === undefined) return null;
  return join(globalRoot, storeRelativePathForMount(store));
}

/** Count markdown files under knowledge/ (sync, for guidance CTA / doctor). */
export function countKnowledgeMarkdown(storeDir: string): number {
  const knowledgeDir = join(storeDir, STORE_LAYOUT.knowledgeDir);
  if (!existsSync(knowledgeDir)) return 0;
  let n = 0;
  const walk = (dir: string) => {
    let names: import("node:fs").Dirent[];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of names) {
      if (ent.name === "pending" || ent.name.startsWith(".")) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith(".md")) n += 1;
    }
  };
  walk(knowledgeDir);
  return n;
}

export function formatFirstHitReport(report: FirstHitReport): string {
  const icon = report.ok ? "✓" : "✗";
  const lines = [
    `${icon} ${report.message}`,
    `  code: ${report.code}`,
    `  write_target: ${report.write_target ?? "(none)"}`,
    `  total_entries: ${report.total_entries}`,
    `  hooks: session_start=${report.hooks.session_start} pre_tool_use=${report.hooks.pre_tool_use}`,
  ];
  if (report.bound_stores.length > 0) {
    lines.push("  stores:");
    for (const s of report.bound_stores) {
      lines.push(`    - ${s.alias}: ${s.entry_count} entr${s.entry_count === 1 ? "y" : "ies"}`);
    }
  }
  if (report.remediations.length > 0) {
    lines.push("  next:");
    for (const r of report.remediations) {
      lines.push(`    → ${r}`);
    }
  }
  return lines.join("\n");
}
