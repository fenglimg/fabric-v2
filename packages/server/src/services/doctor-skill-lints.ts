import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import type { Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck, DoctorIssueKind, DoctorStatus } from "./doctor.js";

export type SkillRefMirrorInspection =
  | { status: "ok" }
  | {
      status: "drift";
      driftedPaths: string[];
    };

export type SkillTokenBudgetInspection = {
  status: "ok" | "warn" | "error";
  overSize: Array<{ slug: string; tokens: number; severity: "warn" | "error" }>;
};

export type SkillDescriptionLintInspection = {
  status: "ok" | "warn";
  issues: Array<{ slug: string; problem: "missing" | "too_long" | "no_cjk" | "no_ascii"; detail: string }>;
};

type SkillMdYamlInvalidCandidate = {
  path: string;
  line: number;
  key: string;
  preview: string;
};

type SkillMdYamlInvalidInspection = {
  candidates: SkillMdYamlInvalidCandidate[];
};

// W3-C: ref-bearing leaf skills whose SKILL.md + ref/ are lint-validated.
// fabric-import folded into fabric-archive `source` mode; store/sync are
// single-file shims (no ref/) so they stay out of the ref-mirror lint set.
const FABRIC_SKILL_SLUGS = ["fabric-archive", "fabric-review"] as const;

const SKILL_MD_FRONTMATTER_ROOTS = [".claude/skills", ".codex/skills"] as const;
const SKILL_FRONTMATTER_KEY_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(.+?)[ \t]*$/u;
const SKILL_QUOTED_VALUE_LEADS = new Set(['"', "'", "[", "{", ">", "|"]);

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
  audience?: "user" | "maintainer",
): DoctorCheck {
  return {
    name,
    status,
    kind,
    code,
    fixable: kind === "fixable_error",
    message,
    actionHint,
    audience,
  };
}

async function listMarkdownFiles(dir: string): Promise<string[] | null> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".md"));
  } catch {
    return null;
  }
}

export async function inspectSkillRefMirror(projectRoot: string): Promise<SkillRefMirrorInspection> {
  const driftedPaths: string[] = [];
  for (const slug of FABRIC_SKILL_SLUGS) {
    const claudeRef = join(projectRoot, ".claude", "skills", slug, "ref");
    const codexRef = join(projectRoot, ".codex", "skills", slug, "ref");
    const [claudeFiles, codexFiles] = await Promise.all([listMarkdownFiles(claudeRef), listMarkdownFiles(codexRef)]);

    if (claudeFiles === null || codexFiles === null) continue;

    const claudeSet = new Set(claudeFiles);
    const codexSet = new Set(codexFiles);
    const union = new Set([...claudeFiles, ...codexFiles]);
    for (const fname of union) {
      const inClaude = claudeSet.has(fname);
      const inCodex = codexSet.has(fname);
      if (!inClaude || !inCodex) {
        driftedPaths.push(`skills/${slug}/ref/${fname}`);
        continue;
      }
      let claudeBody: string;
      let codexBody: string;
      try {
        [claudeBody, codexBody] = await Promise.all([
          readFile(join(claudeRef, fname), "utf8"),
          readFile(join(codexRef, fname), "utf8"),
        ]);
      } catch {
        continue;
      }
      if (claudeBody !== codexBody) {
        driftedPaths.push(`skills/${slug}/ref/${fname}`);
      }
    }
  }
  if (driftedPaths.length === 0) return { status: "ok" };
  return { status: "drift", driftedPaths };
}

export async function inspectSkillTokenBudget(projectRoot: string): Promise<SkillTokenBudgetInspection> {
  const WARN_TOKENS = 5_000;
  const ERROR_TOKENS = 10_000;
  const overSize: Array<{ slug: string; tokens: number; severity: "warn" | "error" }> = [];
  let highestSeverity: "ok" | "warn" | "error" = "ok";
  for (const slug of FABRIC_SKILL_SLUGS) {
    const skillMdPath = join(projectRoot, ".claude", "skills", slug, "SKILL.md");
    let body: string;
    try {
      body = await readFile(skillMdPath, "utf8");
    } catch {
      continue;
    }
    const tokens = Math.ceil(body.length / 3);
    if (tokens > ERROR_TOKENS) {
      overSize.push({ slug, tokens, severity: "error" });
      highestSeverity = "error";
    } else if (tokens > WARN_TOKENS) {
      overSize.push({ slug, tokens, severity: "warn" });
      if (highestSeverity !== "error") highestSeverity = "warn";
    }
  }
  return { status: highestSeverity, overSize };
}

export async function inspectSkillDescription(projectRoot: string): Promise<SkillDescriptionLintInspection> {
  const MAX_DESCRIPTION_TOKENS = 60;
  const issues: SkillDescriptionLintInspection["issues"] = [];
  const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
  const ASCII_PATTERN = /[a-zA-Z]{2,}/u;

  for (const slug of FABRIC_SKILL_SLUGS) {
    const skillMdPath = join(projectRoot, ".claude", "skills", slug, "SKILL.md");
    let body: string;
    try {
      body = await readFile(skillMdPath, "utf8");
    } catch {
      continue;
    }

    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      issues.push({ slug, problem: "missing", detail: "no YAML frontmatter" });
      continue;
    }
    const descMatch = fmMatch[1].match(/^description:\s*(.+?)\s*$/m);
    if (!descMatch || descMatch[1].trim().length === 0) {
      issues.push({ slug, problem: "missing", detail: "description field empty or absent" });
      continue;
    }
    const description = descMatch[1].replace(/^["'](.+)["']$/, "$1");
    const tokens = Math.ceil(description.length / 3);
    if (tokens > MAX_DESCRIPTION_TOKENS) {
      issues.push({ slug, problem: "too_long", detail: `${tokens} tok (max ${MAX_DESCRIPTION_TOKENS})` });
    }
    if (!CJK_PATTERN.test(description)) {
      issues.push({ slug, problem: "no_cjk", detail: "no Chinese trigger phrase" });
    }
    if (!ASCII_PATTERN.test(description)) {
      issues.push({ slug, problem: "no_ascii", detail: "no English trigger phrase" });
    }
  }

  return { status: issues.length === 0 ? "ok" : "warn", issues };
}

export async function inspectSkillMdYamlInvalid(projectRoot: string): Promise<SkillMdYamlInvalidInspection> {
  const candidates: SkillMdYamlInvalidCandidate[] = [];
  for (const rootRel of SKILL_MD_FRONTMATTER_ROOTS) {
    const rootAbs = join(projectRoot, rootRel);
    let dirEntries;
    try {
      dirEntries = await readdir(rootAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirEntry of dirEntries) {
      if (!dirEntry.isDirectory()) continue;
      const skillFile = join(rootAbs, dirEntry.name, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillFile, "utf8");
      } catch {
        continue;
      }
      const frontmatter = extractSkillFrontmatterLines(raw);
      if (frontmatter === null) continue;
      for (const { line, lineNumber } of frontmatter) {
        const match = SKILL_FRONTMATTER_KEY_PATTERN.exec(line);
        if (!match) continue;
        const [, key, value] = match;
        if (value.length === 0) continue;
        if (SKILL_QUOTED_VALUE_LEADS.has(value[0]!)) continue;
        const colonSpaceIdx = value.indexOf(": ");
        const trailingColon = value.endsWith(":");
        if (colonSpaceIdx < 0 && !trailingColon) continue;
        const anchor = colonSpaceIdx >= 0 ? colonSpaceIdx : value.length - 1;
        const previewStart = Math.max(0, anchor - 25);
        const previewEnd = Math.min(value.length, anchor + 30);
        const preview = `${previewStart > 0 ? "..." : ""}${value.slice(previewStart, previewEnd)}${previewEnd < value.length ? "..." : ""}`;
        candidates.push({
          path: posix.join(rootRel, dirEntry.name, "SKILL.md"),
          line: lineNumber,
          key,
          preview,
        });
      }
    }
  }
  candidates.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    return byPath !== 0 ? byPath : a.line - b.line;
  });
  return { candidates };
}

function extractSkillFrontmatterLines(
  raw: string,
): Array<{ line: string; lineNumber: number }> | null {
  const rawLines = raw.split(/\r?\n/u);
  if (rawLines.length < 2) return null;
  if (rawLines[0]?.trim() !== "---") return null;
  const out: Array<{ line: string; lineNumber: number }> = [];
  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    if (line.trim() === "---") {
      return out;
    }
    out.push({ line, lineNumber: i + 1 });
  }
  return null;
}

/**
 * Extract the body lines of a `## <name>` / `### <name>` markdown section,
 * stopping at the next level-2/3 heading. Returns null when the section heading
 * is absent.
 */
function extractMarkdownSectionBody(markdown: string, sectionName: string): string | null {
  const lines = markdown.split(/\r?\n/u);
  const headingRe = /^(#{2,3})\s+(.+?)\s*$/u;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = headingRe.exec(lines[i]!);
    if (h && h[2] === sectionName) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (headingRe.test(lines[i]!)) break;
    out.push(lines[i]!);
  }
  return out.join("\n");
}

export function createSkillRefMirrorCheck(t: Translator, inspection: SkillRefMirrorInspection): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(t("doctor.check.skill_ref_mirror.name"), t("doctor.check.skill_ref_mirror.ok"));
  }
  return issueCheck(
    t("doctor.check.skill_ref_mirror.name"),
    "warn",
    "warning",
    "skill_ref_mirror_drift",
    t("doctor.check.skill_ref_mirror.message", {
      count: String(inspection.driftedPaths.length),
      list: inspection.driftedPaths.join(", "),
    }),
    t("doctor.check.skill_ref_mirror.remediation"),
  );
}

export function createSkillTokenBudgetCheck(t: Translator, inspection: SkillTokenBudgetInspection): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(t("doctor.check.skill_token_budget.name"), t("doctor.check.skill_token_budget.ok"));
  }
  const list = inspection.overSize.map((s) => `${s.slug}=${s.tokens} tok (${s.severity})`).join(", ");
  const count = inspection.overSize.length;
  return issueCheck(
    t("doctor.check.skill_token_budget.name"),
    inspection.status,
    inspection.status === "error" ? "manual_error" : "warning",
    "skill_token_budget_exceeded",
    t(`doctor.check.skill_token_budget.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      list,
    }),
    t("doctor.check.skill_token_budget.remediation"),
    "maintainer",
  );
}

export function createSkillDescriptionCheck(t: Translator, inspection: SkillDescriptionLintInspection): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(t("doctor.check.skill_description.name"), t("doctor.check.skill_description.ok"));
  }
  const list = inspection.issues.map((issue) => `${issue.slug}: ${issue.problem} (${issue.detail})`).join("; ");
  const count = inspection.issues.length;
  return issueCheck(
    t("doctor.check.skill_description.name"),
    "warn",
    "warning",
    "skill_description_quality",
    t(`doctor.check.skill_description.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      list,
    }),
    t("doctor.check.skill_description.remediation"),
    "maintainer",
  );
}

export function createSkillMdYamlInvalidCheck(t: Translator, inspection: SkillMdYamlInvalidInspection): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return okCheck(t("doctor.check.skill_md_yaml_invalid.name"), t("doctor.check.skill_md_yaml_invalid.ok"));
  }
  const first = inspection.candidates[0]!;
  const detail = `${first.path}:${first.line} (key \`${first.key}\` value contains an unquoted ': ' — preview: \`${first.preview}\`)`;
  const singular = inspection.candidates.length === 1;
  return issueCheck(
    t("doctor.check.skill_md_yaml_invalid.name"),
    "warn",
    "warning",
    "skill_md_yaml_invalid",
    t(`doctor.check.skill_md_yaml_invalid.message.${singular ? "singular" : "plural"}`, {
      count: String(inspection.candidates.length),
      detail,
    }),
    t("doctor.check.skill_md_yaml_invalid.remediation"),
  );
}
