import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { Script } from "node:vm";

import type { Translator } from "@fenglimg/fabric-shared";

import { sha256 } from "./_shared.js";
import type { DoctorCheck, DoctorIssueKind, DoctorStatus } from "./doctor.js";

type HooksWiredStatus = "ok" | "skipped" | "missing-settings" | "incomplete";
type HooksWiredInspection = {
  status: HooksWiredStatus;
  missingHooks: string[];
};

type HookContentDriftPair = {
  basename: string;
  clients: Array<"claude" | "codex" | "cursor">;
  hashes: Array<{ client: string; sha: string }>;
};
type HooksContentDriftInspection = {
  scanned: number;
  drifts: HookContentDriftPair[];
};

type HookRuntimeIssue = {
  path: string;
  client: "claude" | "codex" | "cursor";
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

const HOOKS_RUNTIME_CLIENT_DIRS: Array<{ client: "claude" | "codex" | "cursor"; dir: string }> = [
  { client: "claude", dir: ".claude/hooks" },
  { client: "codex", dir: ".codex/hooks" },
  { client: "cursor", dir: ".cursor/hooks" },
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

function isHookWiredForEvent(hooks: unknown, event: string, hookFile: string): boolean {
  if (!isRecord(hooks)) return false;
  const eventEntries = hooks[event];
  if (!Array.isArray(eventEntries)) return false;
  for (const matcherBlock of eventEntries) {
    if (!isRecord(matcherBlock)) continue;
    const inner = matcherBlock.hooks;
    if (!Array.isArray(inner)) continue;
    for (const hookEntry of inner) {
      if (!isRecord(hookEntry)) continue;
      const cmd = hookEntry.command;
      if (typeof cmd === "string" && cmd.includes(hookFile)) {
        return true;
      }
    }
  }
  return false;
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

export async function inspectHooksWired(projectRoot: string): Promise<HooksWiredInspection> {
  const claudeEntries = await readDirectoryFileNames(join(projectRoot, ".claude"));
  if (claudeEntries === null) {
    return { status: "skipped", missingHooks: [] };
  }
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
  } catch {
    return { status: "missing-settings", missingHooks: [] };
  }
  const required: Array<{ event: string; hookFile: string }> = [
    { event: "Stop", hookFile: "fabric-hint.cjs" },
    { event: "SessionStart", hookFile: "knowledge-hint-broad.cjs" },
    { event: "PreToolUse", hookFile: "knowledge-hint-narrow.cjs" },
  ];
  const missing: string[] = [];
  const hooksSection = isRecord(parsed) ? parsed.hooks : undefined;
  for (const { event, hookFile } of required) {
    if (!isHookWiredForEvent(hooksSection, event, hookFile)) {
      missing.push(`${event}:${hookFile}`);
    }
  }
  if (missing.length === 0) {
    return { status: "ok", missingHooks: [] };
  }
  return { status: "incomplete", missingHooks: missing };
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
    Array<{ client: "claude" | "codex" | "cursor"; abs: string }>
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
  if (inspection.status === "missing-settings") {
    return issueCheck(
      t("doctor.check.hooks_wired.name"),
      "warn",
      "warning",
      "hooks_wired_missing_settings",
      t("doctor.check.hooks_wired.message.missing_settings"),
      t("doctor.check.hooks_wired.remediation"),
    );
  }
  return issueCheck(
    t("doctor.check.hooks_wired.name"),
    "warn",
    "warning",
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
