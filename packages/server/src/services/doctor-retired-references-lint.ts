import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative } from "node:path";

import type { Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor.js";

// ux-w2-2: registry-driven retired-reference lint. The root cause of the W0-1 /
// W0-2 class of bug is a STALE POINTER — agent-facing instruction text (a hook
// string, a bootstrap line, a SKILL.md) that still names a tool/field which was
// renamed or deleted. Each retirement registers the dead token + its replacement
// here; the lint scans the shipped agent-consumed surface and flags any survivor
// so the pointer can never silently rot again.
//
// Scope: ONLY agent-consumed instruction surfaces — the bootstrap anchor, the
// installed SKILL.md / ref markdown, and the installed hook scripts. TypeScript
// source (e.g. the legitimate `cli.config.fields.fabric_language` i18n key) is
// out of scope, so a retired CONFIG field name can be registered without
// false-firing on its surviving schema/i18n machinery.
export interface RetiredToken {
  /** The exact dead token as it appears in agent-facing text. */
  token: string;
  /** What replaced it (shown in the remediation), or null when simply removed. */
  replacement: string | null;
  /** Short why-retired note. */
  reason: string;
}

export const RETIRED_TOKENS: readonly RetiredToken[] = [
  { token: "fab_plan_context", replacement: "fab_recall", reason: "retrieval collapsed to one lean fab_recall (KT-DEC-0026)" },
  { token: "fab_get_knowledge_sections", replacement: "fab_recall", reason: "two-step fetch retired (KT-DEC-0026)" },
  { token: "fab_extract_knowledge", replacement: "fab_propose", reason: "tool renamed to match propose/write semantics (ux-w1-1)" },
  { token: "hint_broad_budget_chars", replacement: null, reason: "index-only SessionStart sink has no body budget (ux-w1-5)" },
  { token: "cite_evict_interval", replacement: "cite_recall_nudge", reason: "turn-counter superseded by recall-aware nudge (ux-w1-5)" },
  { token: "reverse_unarchive_enabled", replacement: null, reason: "never-wired opt-in flag deleted (ux-w1-5)" },
  { token: "reverse_unarchive_dry_run", replacement: null, reason: "unarchive dryRun comes from the caller, not config (ux-w1-5)" },
  { token: "doctor --cite-coverage", replacement: "audit cite", reason: "cite audit moved to the audit group (W3-D)" },
  { token: "doctor --fix-knowledge", replacement: "doctor --fix", reason: "fix-knowledge merged into a single --fix (W3-D)" },
  { token: "store add", replacement: "store mount", reason: "de-synonymised: add → mount (W3-E)" },
  { token: "store route-write", replacement: "store switch-write --scope", reason: "route-write folded into switch-write --scope (W3-E)" },
  { token: "store re-scope", replacement: "store migrate scope", reason: "scope-rewrite ops grouped under `store migrate` (W3-E)" },
  { token: "store backfill-scope", replacement: "store migrate backfill", reason: "scope-rewrite ops grouped under `store migrate` (W3-E)" },
  { token: "store promote", replacement: "store migrate promote", reason: "scope-rewrite ops grouped under `store migrate` (W3-E)" },
  { token: "fabric scope-explain", replacement: "fabric info scope", reason: "scope-explain command merged into the `info scope` subcommand (W3-F)" },
  { token: "fabric context", replacement: "fabric inspect", reason: "renamed: `context` of what? → `inspect` the injection (W3-F / NS-01 §1)" },
  { token: "fabric metrics", replacement: "fabric audit metrics", reason: "top-level metrics retired; reachable as `audit metrics` (W3-F)" },
  { token: "hint_broad_top_k", replacement: null, reason: "W2-1 retired the broad hard cap; broad_index_backstop is the sole guard (W3-J)" },
];

export interface RetiredReferenceHit {
  /** Project-relative POSIX path of the offending file. */
  path: string;
  token: string;
  line: number;
  replacement: string | null;
}

export interface RetiredReferenceInspection {
  status: "ok" | "warn" | "skipped";
  scannedFiles: number;
  hits: RetiredReferenceHit[];
}

const HOOK_DIRS = [".claude/hooks", ".codex/hooks"];
const SKILL_DIRS = [".claude/skills", ".codex/skills"];
const BOOTSTRAP_FILES = ["AGENTS.md", "CLAUDE.md", join(".fabric", "AGENTS.md")];

// A pure-comment line in a .cjs hook legitimately documents a retirement (e.g.
// "fab_plan_context → fab_recall is retired"); those are history, not a live
// pointer, so they are skipped. Matches `//…`, `/*`, `*…`, `*/` lead lines.
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

async function walkFiles(dir: string, exts: string[]): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkFiles(full, exts)));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function scanText(
  rel: string,
  text: string,
  skipComments: boolean,
  hits: RetiredReferenceHit[],
): void {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (skipComments && isCommentLine(line)) continue;
    for (const { token, replacement } of RETIRED_TOKENS) {
      if (line.includes(token)) {
        hits.push({ path: rel, token, line: i + 1, replacement });
      }
    }
  }
}

export async function inspectRetiredReferences(
  projectRoot: string,
): Promise<RetiredReferenceInspection> {
  const hits: RetiredReferenceHit[] = [];
  let scannedFiles = 0;
  const toRel = (p: string) => posix.normalize(relative(projectRoot, p).split("\\").join("/"));

  // Bootstrap anchors (markdown — never skip "comment" lines).
  for (const rel of BOOTSTRAP_FILES) {
    const abs = join(projectRoot, rel);
    try {
      if ((await stat(abs)).isFile()) {
        scannedFiles += 1;
        scanText(toRel(abs), await readFile(abs, "utf8"), false, hits);
      }
    } catch {
      // absent — fine
    }
  }

  // SKILL markdown (agent instructions — never skip comment lines).
  for (const dir of SKILL_DIRS) {
    for (const file of await walkFiles(join(projectRoot, dir), [".md"])) {
      scannedFiles += 1;
      try {
        scanText(toRel(file), await readFile(file, "utf8"), false, hits);
      } catch {
        // unreadable — skip
      }
    }
  }

  // Installed hook scripts (.cjs — SKIP pure-comment lines; a live pointer is an
  // emitted string, not a history comment).
  for (const dir of HOOK_DIRS) {
    for (const file of await walkFiles(join(projectRoot, dir), [".cjs"])) {
      scannedFiles += 1;
      try {
        scanText(toRel(file), await readFile(file, "utf8"), true, hits);
      } catch {
        // unreadable — skip
      }
    }
  }

  if (scannedFiles === 0) {
    return { status: "skipped", scannedFiles, hits: [] };
  }
  hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { status: hits.length > 0 ? "warn" : "ok", scannedFiles, hits };
}

export function createRetiredReferenceCheck(
  t: Translator,
  inspection: RetiredReferenceInspection,
): DoctorCheck {
  const name = t("doctor.check.retired_reference.name");
  if (inspection.status !== "warn") {
    return { name, status: "ok", message: t("doctor.check.retired_reference.ok") };
  }
  const sample = inspection.hits
    .slice(0, 5)
    .map((h) =>
      h.replacement
        ? `${h.path}:${h.line} \`${h.token}\` → \`${h.replacement}\``
        : `${h.path}:${h.line} \`${h.token}\` (removed)`,
    )
    .join("; ");
  return {
    name,
    status: "warn",
    kind: "warning",
    code: "retired_reference",
    audience: "maintainer",
    message: t("doctor.check.retired_reference.message", {
      count: String(inspection.hits.length),
      sample,
    }),
    actionHint: t("doctor.check.retired_reference.remediation"),
  };
}
