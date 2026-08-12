import { constants } from "node:fs";
import { access, readdir, readFile, rename, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { Script } from "node:vm";

import {
  HOOK_CLIENTS,
  HOOK_REGISTRATIONS,
  mergeFabricHookRegistrations,
  type HookClient,
  type Translator,
} from "@fenglimg/fabric-shared";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";

import { sha256 } from "../_shared.js";
import type { DoctorCheck, DoctorIssueKind, DoctorStatus } from "../doctor-types.js";

type HooksWiredStatus = "ok" | "skipped" | "config-missing" | "config-unparseable" | "incomplete";
type HooksWiredInspection = {
  status: HooksWiredStatus;
  /** `"<config file> <Event>:<hook>.cjs"` per registration that is not wired. */
  missingHooks: string[];
  /** Config files that exist but do not parse as JSON. */
  unparseableConfigs: string[];
  /** Config files a client dir should have but does not. */
  missingConfigs: string[];
};

type HookContentDriftPair = {
  basename: string;
  clients: Array<"claude" | "codex">;
  hashes: Array<{ client: string; sha: string }>;
};
type HooksContentDriftInspection = {
  scanned: number;
  drifts: HookContentDriftPair[];
};

type HookRuntimeIssue = {
  path: string;
  client: "claude" | "codex";
  kind: "missing_shebang" | "parse_error" | "read_error";
  detail: string;
};
type HooksRuntimeInspection = {
  scanned: number;
  issues: HookRuntimeIssue[];
};

type HookCacheWritabilityInspection =
  | { writable: true; path: string }
  | { writable: false; path: string; error: string };

const HOOKS_RUNTIME_CLIENT_DIRS: Array<{ client: "claude" | "codex"; dir: string }> = [
  { client: "claude", dir: ".claude/hooks" },
  { client: "codex", dir: ".codex/hooks" },
];

function okCheck(name: string, message: string): DoctorCheck {
  return { name, status: "ok", message };
}

function issueCheck(
  name: string,
  status: DoctorStatus,
  kind: DoctorIssueKind,
  code: string,
  message: string,
  actionHint?: string,
): DoctorCheck {
  return {
    name,
    status,
    kind,
    code,
    fixable: kind === "fixable_error",
    message,
    actionHint,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return posix.normalize(path.split("\\").join("/"));
}

function isNodeMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// The two clients nest the command differently — Claude Code wraps entries in a
// matcher block carrying `hooks: [{ command }]`, Codex puts `command` directly
// on the entry — so accept either rather than assuming one shape.
function commandsInEntry(entry: unknown): string[] {
  if (!isRecord(entry)) return [];
  const own = typeof entry.command === "string" ? [entry.command] : [];
  const nested = Array.isArray(entry.hooks)
    ? entry.hooks.flatMap((inner) =>
        isRecord(inner) && typeof inner.command === "string" ? [inner.command] : [],
      )
    : [];
  return [...own, ...nested];
}

function isHookWiredForEvent(events: unknown, event: string, hookFile: string): boolean {
  if (!isRecord(events)) return false;
  const eventEntries = events[event];
  if (!Array.isArray(eventEntries)) return false;
  return eventEntries.some((entry) =>
    commandsInEntry(entry).some((cmd) => cmd.includes(hookFile)),
  );
}

async function readDirectoryFileNames(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir);
  } catch {
    return null;
  }
}

async function isFile(absPath: string): Promise<boolean> {
  try {
    return (await stat(absPath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Which of Fabric's hooks are actually registered in each installed client's
 * hook config.
 *
 * A hook that is shipped to disk but not registered is completely silent: the
 * client never invokes it, and nothing else in the system notices. That is what
 * makes this check load-bearing rather than cosmetic, and why the required set
 * is derived from HOOK_REGISTRATIONS instead of hand-listed here — the previous
 * hand-written list had drifted to 3 of Claude Code's 5 hooks and none of
 * Codex's, so a config missing PostToolUse / SessionEnd reported healthy.
 *
 * A client whose directory is absent is not installed, and is skipped rather
 * than reported missing.
 */
export async function inspectHooksWired(projectRoot: string): Promise<HooksWiredInspection> {
  const missingHooks: string[] = [];
  const unparseableConfigs: string[] = [];
  const missingConfigs: string[] = [];
  let inspectedClients = 0;

  for (const client of HOOK_CLIENTS) {
    const { clientDir, configFile, configRoot, registrations } = HOOK_REGISTRATIONS[client];
    if ((await readDirectoryFileNames(join(projectRoot, clientDir))) === null) {
      continue;
    }
    inspectedClients += 1;

    let raw: string;
    try {
      raw = await readFile(join(projectRoot, ...configFile.split("/")), "utf8");
    } catch {
      missingConfigs.push(configFile);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // Distinct from absent on purpose: an absent config can be written from
      // scratch, whereas a corrupt one holds user content that must be
      // preserved before anything is rewritten over it.
      unparseableConfigs.push(configFile);
      continue;
    }

    const eventsSection = isRecord(parsed) ? parsed[configRoot] : undefined;
    for (const { event, hookFile } of registrations) {
      if (!isHookWiredForEvent(eventsSection, event, hookFile)) {
        missingHooks.push(`${configFile} ${event}:${hookFile}`);
      }
    }
  }

  if (inspectedClients === 0) {
    return { status: "skipped", missingHooks: [], unparseableConfigs: [], missingConfigs: [] };
  }
  // Unparseable outranks the rest: until the file is readable, "which hooks are
  // wired" is unanswerable for that client, so reporting it as merely
  // incomplete would understate the failure.
  if (unparseableConfigs.length > 0) {
    return { status: "config-unparseable", missingHooks, unparseableConfigs, missingConfigs };
  }
  if (missingConfigs.length > 0) {
    return { status: "config-missing", missingHooks, unparseableConfigs, missingConfigs };
  }
  if (missingHooks.length > 0) {
    return { status: "incomplete", missingHooks, unparseableConfigs, missingConfigs };
  }
  return { status: "ok", missingHooks: [], unparseableConfigs: [], missingConfigs: [] };
}

export type HookConfigFixResult = {
  /** Config files that gained (or regained) fabric's registrations. */
  rewritten: string[];
  /** `<config>` → the sidecar its unparseable content was preserved as. */
  preserved: Array<{ config: string; preservedAs: string }>;
};

/**
 * Re-register fabric's hooks in every installed client's hook config.
 *
 * Two flavors, per KT-GLD-0016. A config that is absent or already valid JSON
 * is written straight through — merging is append-with-dedupe, so a re-run is a
 * no-op and the user's own hooks survive. A config that does NOT parse is a
 * different problem: it holds user-authored content that no automated merge can
 * read, so it is RENAMED aside first (never deleted) and a fresh fabric config
 * takes its place. The caller surfaces the sidecar path so the operator can
 * merge their settings back by hand.
 */
export async function fixHookConfigs(projectRoot: string): Promise<HookConfigFixResult> {
  const rewritten: string[] = [];
  const preserved: Array<{ config: string; preservedAs: string }> = [];

  for (const client of HOOK_CLIENTS as readonly HookClient[]) {
    const { clientDir, configFile } = HOOK_REGISTRATIONS[client];
    if ((await readDirectoryFileNames(join(projectRoot, clientDir))) === null) {
      continue;
    }
    const absPath = join(projectRoot, ...configFile.split("/"));

    let existing: unknown = {};
    let raw: string | null = null;
    try {
      raw = await readFile(absPath, "utf8");
    } catch {
      raw = null; // absent — merge into an empty config below
    }
    if (raw !== null) {
      try {
        existing = JSON.parse(raw) as unknown;
      } catch {
        const preservedAs = `${configFile}.broken-${Date.now()}`;
        await rename(absPath, join(projectRoot, ...preservedAs.split("/")));
        preserved.push({ config: configFile, preservedAs });
        existing = {};
      }
    }

    const merged = mergeFabricHookRegistrations(existing, client);
    if (raw !== null && JSON.stringify(merged) === JSON.stringify(existing)) {
      continue; // already fully wired — nothing to claim as fixed
    }
    await atomicWriteJson(absPath, merged);
    rewritten.push(configFile);
  }

  return { rewritten, preserved };
}

export async function inspectHookCacheWritability(
  projectRoot: string,
): Promise<HookCacheWritabilityInspection> {
  const relPath = posix.join(".fabric", ".cache");
  const fabricDir = join(projectRoot, ".fabric");
  const cacheDir = join(projectRoot, ".fabric", ".cache");
  try {
    try {
      const cacheStats = await stat(cacheDir);
      if (!cacheStats.isDirectory()) {
        return {
          writable: false,
          path: relPath,
          error: `${relPath} exists but is not a directory`,
        };
      }
      await access(cacheDir, constants.W_OK);
      return { writable: true, path: relPath };
    } catch (error) {
      if (!isNodeMissingPathError(error)) {
        throw error;
      }
    }

    let parent = fabricDir;
    try {
      await stat(fabricDir);
    } catch (error) {
      if (!isNodeMissingPathError(error)) {
        throw error;
      }
      parent = projectRoot;
    }
    const parentStats = await stat(parent);
    if (!parentStats.isDirectory()) {
      return {
        writable: false,
        path: relPath,
        error: `${normalizePath(parent)} exists but is not a directory`,
      };
    }
    await access(parent, constants.W_OK);
    return { writable: true, path: relPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      writable: false,
      path: relPath,
      error: message,
    };
  }
}

export async function inspectHooksContentDrift(projectRoot: string): Promise<HooksContentDriftInspection> {
  const hookFilesByBasename = new Map<
    string,
    Array<{ client: "claude" | "codex"; abs: string }>
  >();
  for (const { client, dir } of HOOKS_RUNTIME_CLIENT_DIRS) {
    const absDir = join(projectRoot, dir);
    const entries = await readDirectoryFileNames(absDir);
    if (entries === null) continue;
    for (const name of entries) {
      if (!name.endsWith(".cjs")) continue;
      const abs = join(absDir, name);
      if (!(await isFile(abs))) continue;
      const arr = hookFilesByBasename.get(name) ?? [];
      arr.push({ client, abs });
      hookFilesByBasename.set(name, arr);
    }
  }
  const drifts: HookContentDriftPair[] = [];
  let scanned = 0;
  for (const [basename, copies] of hookFilesByBasename) {
    if (copies.length < 2) continue;
    scanned += copies.length;
    const hashes: Array<{ client: string; sha: string }> = [];
    for (const { client, abs } of copies) {
      try {
        const body = await readFile(abs, "utf8");
        hashes.push({ client, sha: sha256(body) });
      } catch {
        // Unreadable copies are reported by hooks_runtime; skip drift comparison.
      }
    }
    if (hashes.length < 2) continue;
    const first = hashes[0].sha;
    if (hashes.some((h) => h.sha !== first)) {
      drifts.push({
        basename,
        clients: copies.map((copy) => copy.client),
        hashes,
      });
    }
  }
  drifts.sort((a, b) => a.basename.localeCompare(b.basename));
  return { scanned, drifts };
}

export async function inspectHooksRuntime(projectRoot: string): Promise<HooksRuntimeInspection> {
  const issues: HookRuntimeIssue[] = [];
  let scanned = 0;
  for (const { client, dir } of HOOKS_RUNTIME_CLIENT_DIRS) {
    const absDir = join(projectRoot, dir);
    const entries = await readDirectoryFileNames(absDir);
    if (entries === null) continue;
    for (const name of entries) {
      if (!name.endsWith(".cjs")) continue;
      const abs = join(absDir, name);
      const displayPath = `${dir}/${name}`;
      if (!(await isFile(abs))) continue;
      scanned += 1;
      let body: string;
      try {
        body = await readFile(abs, "utf8");
      } catch (err) {
        issues.push({
          path: displayPath,
          client,
          kind: "read_error",
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (!body.startsWith("#!")) {
        issues.push({
          path: displayPath,
          client,
          kind: "missing_shebang",
          detail: "first line is not a `#!` shebang",
        });
      }
      try {
        new Script(body, { filename: displayPath });
      } catch (err) {
        issues.push({
          path: displayPath,
          client,
          kind: "parse_error",
          detail: err instanceof Error ? err.message.split("\n")[0] : String(err),
        });
      }
    }
  }
  issues.sort((a, b) => a.path.localeCompare(b.path));
  return { scanned, issues };
}

export function createHooksWiredCheck(t: Translator, inspection: HooksWiredInspection): DoctorCheck {
  if (inspection.status === "skipped") {
    return okCheck(t("doctor.check.hooks_wired.name"), t("doctor.check.hooks_wired.ok.skipped"));
  }
  if (inspection.status === "ok") {
    return okCheck(t("doctor.check.hooks_wired.name"), t("doctor.check.hooks_wired.ok.wired"));
  }
  // All three are errors, not warnings: every one of them means the client is
  // running with some or all of Fabric's hooks inert, which produces no other
  // symptom. `hook_config_unparseable` is the one a machine must not resolve on
  // its own — the file holds user-authored config that a rewrite would destroy,
  // so --fix preserves it and the operator decides (KT-GLD-0016).
  if (inspection.status === "config-unparseable") {
    return issueCheck(
      t("doctor.check.hooks_wired.name"),
      "error",
      "fixable_error",
      "hook_config_unparseable",
      t("doctor.check.hooks_wired.message.config_unparseable", {
        configs: inspection.unparseableConfigs.join(", "),
      }),
      t("doctor.check.hooks_wired.remediation.config_unparseable"),
    );
  }
  if (inspection.status === "config-missing") {
    return issueCheck(
      t("doctor.check.hooks_wired.name"),
      "error",
      "fixable_error",
      "hook_config_missing",
      t("doctor.check.hooks_wired.message.config_missing", {
        configs: inspection.missingConfigs.join(", "),
      }),
      t("doctor.check.hooks_wired.remediation"),
    );
  }
  return issueCheck(
    t("doctor.check.hooks_wired.name"),
    "error",
    "fixable_error",
    "hooks_wired_incomplete",
    t("doctor.check.hooks_wired.message.incomplete", {
      missing: inspection.missingHooks.join(", "),
    }),
    t("doctor.check.hooks_wired.remediation"),
  );
}

export function createHooksContentDriftCheck(
  t: Translator,
  inspection: HooksContentDriftInspection,
): DoctorCheck {
  if (inspection.scanned === 0) {
    return okCheck(t("doctor.check.hooks_content_drift.name"), t("doctor.check.hooks_content_drift.ok.skipped"));
  }
  if (inspection.drifts.length === 0) {
    return okCheck(
      t("doctor.check.hooks_content_drift.name"),
      t("doctor.check.hooks_content_drift.ok.aligned", {
        count: String(inspection.scanned),
      }),
    );
  }
  const first = inspection.drifts[0];
  return issueCheck(
    t("doctor.check.hooks_content_drift.name"),
    "warn",
    "warning",
    "hooks_content_drift",
    t("doctor.check.hooks_content_drift.message", {
      count: String(inspection.drifts.length),
      first_basename: first.basename,
      first_clients: first.clients.join(", "),
    }),
    t("doctor.check.hooks_content_drift.remediation"),
  );
}

export function createHooksRuntimeCheck(t: Translator, inspection: HooksRuntimeInspection): DoctorCheck {
  if (inspection.scanned === 0) {
    return okCheck(t("doctor.check.hooks_runtime.name"), t("doctor.check.hooks_runtime.ok.skipped"));
  }
  if (inspection.issues.length === 0) {
    return okCheck(
      t("doctor.check.hooks_runtime.name"),
      t("doctor.check.hooks_runtime.ok.healthy", {
        count: String(inspection.scanned),
      }),
    );
  }
  const first = inspection.issues[0];
  const count = inspection.issues.length;
  return issueCheck(
    t("doctor.check.hooks_runtime.name"),
    "warn",
    "warning",
    "hooks_runtime_invalid",
    t(`doctor.check.hooks_runtime.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      first_path: first.path,
      first_detail: `${first.kind}: ${first.detail}`,
    }),
    t("doctor.check.hooks_runtime.remediation"),
  );
}

export function createHookCacheWritabilityCheck(
  t: Translator,
  inspection: HookCacheWritabilityInspection,
): DoctorCheck {
  if (inspection.writable) {
    return okCheck(
      t("doctor.check.hook_cache_writable.name"),
      t("doctor.check.hook_cache_writable.ok", { path: inspection.path }),
    );
  }
  return issueCheck(
    t("doctor.check.hook_cache_writable.name"),
    "warn",
    "warning",
    "hook_cache_not_writable",
    t("doctor.check.hook_cache_writable.message", {
      path: inspection.path,
      error: inspection.error,
    }),
    t("doctor.check.hook_cache_writable.remediation", {
      path: inspection.path,
    }),
  );
}
