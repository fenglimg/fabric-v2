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
  issues: Array<{
    slug: string;
    problem: "missing" | "too_long" | "no_cjk" | "no_ascii" | "missing_anti_trigger";
    detail: string;
  }>;
};

export type SkillContractInspection = {
  status: "ok" | "warn";
  issues: Array<{
    slug: string;
    client: ".claude" | ".codex";
    problem: "missing_contract_token" | "missing_ref_entry" | "missing_thin_shim_token";
    detail: string;
  }>;
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
const FABRIC_CONTRACT_SKILL_SLUGS = ["fabric-archive", "fabric-review", "fabric-store", "fabric-sync"] as const;

const SKILL_MD_FRONTMATTER_ROOTS = [".claude/skills", ".codex/skills"] as const;
const SKILL_FRONTMATTER_KEY_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(.+?)[ \t]*$/u;
const SKILL_QUOTED_VALUE_LEADS = new Set(['"', "'", "[", "{", ">", "|"]);

const SKILL_CONTRACT_TOKENS: Record<(typeof FABRIC_CONTRACT_SKILL_SLUGS)[number], string[]> = {
  "fabric-archive": [
    "## Hard Rules",
    "### DISPLAY Rules",
    "### WRITE Rules",
    "mcp__fabric__fab_propose",
    "only legal write path",
    "reached-but-inert",
  ],
  "fabric-review": [
    "## Hard Rules",
    "### DISPLAY Rules",
    "### WRITE Rules",
    "mcp__fabric__fab_review",
    "only legal mutation path",
    "reached-but-inert",
    "changes next action",
    "must_read_if",
    "intent_clues",
    "impact",
  ],
  "fabric-store": ["thin shim", "CLI", "本 skill 只", "NEVER"],
  "fabric-sync": ["thin shim", "CLI", "本 skill 只", "NEVER"],
};

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
  const ANTI_TRIGGER_PATTERN = /\bNOT\b|ONLY when|do not|不要|不是|非/u;

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
    if (!ANTI_TRIGGER_PATTERN.test(description)) {
      issues.push({
        slug,
        problem: "missing_anti_trigger",
        detail: "no explicit non-trigger phrase such as NOT/不是/不要",
      });
    }
  }

  return { status: issues.length === 0 ? "ok" : "warn", issues };
}

export async function inspectSkillContract(projectRoot: string): Promise<SkillContractInspection> {
  const issues: SkillContractInspection["issues"] = [];

  for (const rootRel of SKILL_MD_FRONTMATTER_ROOTS) {
    const client = rootRel.startsWith(".claude") ? ".claude" : ".codex";
    for (const slug of FABRIC_CONTRACT_SKILL_SLUGS) {
      const skillDir = join(projectRoot, rootRel, slug);
      const skillMdPath = join(skillDir, "SKILL.md");
      let body: string;
      try {
        body = await readFile(skillMdPath, "utf8");
      } catch {
        continue;
      }

      for (const token of SKILL_CONTRACT_TOKENS[slug]) {
        if (body.includes(token)) continue;
        issues.push({
          slug,
          client,
          problem: slug === "fabric-store" || slug === "fabric-sync"
            ? "missing_thin_shim_token"
            : "missing_contract_token",
          detail: token,
        });
      }

      const refDir = join(skillDir, "ref");
      let refFiles: string[] | null;
      try {
        refFiles = (await readdir(refDir)).filter((name) => name.endsWith(".md"));
      } catch {
        refFiles = null;
      }
      if (refFiles === null) continue;

      for (const fname of refFiles) {
        if (body.includes(fname) || body.includes(`ref/${fname}`)) continue;
        issues.push({
          slug,
          client,
          problem: "missing_ref_entry",
          detail: fname,
        });
      }
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

// W3-C: extractMarkdownSectionBody removed — its only caller was the retired
// router-chain S_CHAIN lint (the fabric/ router is gone, 0-router skill set).

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

export function createSkillContractCheck(t: Translator, inspection: SkillContractInspection): DoctorCheck {
  if (inspection.status === "ok") {
    return okCheck(t("doctor.check.skill_contract.name"), t("doctor.check.skill_contract.ok"));
  }
  const list = inspection.issues
    .map((issue) => `${issue.client}/${issue.slug}: ${issue.problem} (${issue.detail})`)
    .join("; ");
  const count = inspection.issues.length;
  return issueCheck(
    t("doctor.check.skill_contract.name"),
    "warn",
    "warning",
    "skill_contract_integrity",
    t(`doctor.check.skill_contract.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      list,
    }),
    t("doctor.check.skill_contract.remediation"),
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
