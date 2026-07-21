import { readFile, writeFile } from "node:fs/promises";

import type { Translator } from "@fenglimg/fabric-shared";

import { extractBody } from "./_shared.js";
import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import { classifySummaryState } from "./extract-knowledge.js";
import type { DoctorCheck } from "./doctor-types.js";

export type BodyDedupFinding =
  | "body_summary_verbatim"
  | "body_summary_near"
  | "body_summary_diverged"
  | "body_evidence_redundant"
  | "body_why_proposed_obsolete"
  | "body_session_context_rename"
  | "fm_tech_stack_merge";

export type BodyDedupEntry = {
  stable_id: string;
  path: string;
  findings: BodyDedupFinding[];
};

export interface BodyDedupInspection {
  entries: BodyDedupEntry[];
  errored?: boolean;
  error_message?: string;
}

const SUMMARY_RE = /\n## Summary\s*\n/u;
const EVIDENCE_RE = /\n## Evidence(?:\s*\(call \d+\))?\s*\n/u;
const WHY_PROPOSED_RE = /\n## Why proposed\s*\n/u;
const SESSION_CONTEXT_RE = /\n## Session context\s*\n/u;

function readFmKey(content: string, key: string): string | undefined {
  const match = /^---\n([\s\S]*?)\n---/u.exec(content);
  if (match === null) return undefined;
  const block = match[1] ?? "";
  for (const line of block.split(/\r?\n/u)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    if (line.slice(0, sep).trim() === key) {
      return line.slice(sep + 1).trim();
    }
  }
  return undefined;
}

function extractBodySummary(bodyText: string): string | undefined {
  const m = /\n## Summary\s*\n([\s\S]*?)(?=\n## |$)/u.exec(`\n${bodyText}`);
  if (m === null) return undefined;
  return (m[1] ?? "").trim() || undefined;
}

export async function inspectBodyDedup(projectRoot: string): Promise<BodyDedupInspection> {
  const entries: BodyDedupEntry[] = [];
  try {
    const corpus = await collectStoreCanonicalEntries(projectRoot);
    for (const entry of corpus) {
      const raw = entry.body;
      const bodyText = extractBody(raw);
      const padded = `\n${bodyText}`;
      const findings: BodyDedupFinding[] = [];

      const fmSummary = readFmKey(raw, "summary");
      if (fmSummary && SUMMARY_RE.test(padded)) {
        const bodySummary = extractBodySummary(bodyText);
        if (bodySummary) {
          const state = classifySummaryState(bodySummary, fmSummary);
          if (state === "verbatim") findings.push("body_summary_verbatim");
          else if (state === "near") findings.push("body_summary_near");
          else findings.push("body_summary_diverged");
        }
      }

      const fmEvidence = readFmKey(raw, "evidence_paths");
      if (fmEvidence && EVIDENCE_RE.test(padded)) {
        findings.push("body_evidence_redundant");
      }

      if (WHY_PROPOSED_RE.test(padded)) {
        findings.push("body_why_proposed_obsolete");
      }

      if (SESSION_CONTEXT_RE.test(padded)) {
        findings.push("body_session_context_rename");
      }

      if (readFmKey(raw, "tech_stack")) {
        findings.push("fm_tech_stack_merge");
      }

      if (findings.length > 0) {
        entries.push({
          stable_id: entry.qualifiedId,
          path: entry.file || `store:${entry.qualifiedId}`,
          findings,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { entries: [], errored: true, error_message: message };
  }
  entries.sort((a, b) => a.stable_id.localeCompare(b.stable_id));
  return { entries };
}

function countFixable(entries: BodyDedupEntry[]): number {
  return entries.filter((e) =>
    e.findings.some((f) => f !== "body_summary_diverged"),
  ).length;
}

export function createBodyDedupCheck(
  t: Translator,
  inspection: BodyDedupInspection,
): DoctorCheck {
  if (inspection.errored) {
    return {
      name: t("doctor.check.knowledge_body_dedup.name"),
      status: "warn",
      kind: "warning",
      code: "knowledge_body_dedup_scan_error",
      fixable: false,
      message: t("doctor.check.knowledge_body_dedup.scan_error", {
        detail: inspection.error_message ?? "unknown",
      }),
      actionHint: t("doctor.check.knowledge_body_dedup.remediation"),
    };
  }
  if (inspection.entries.length === 0) {
    return {
      name: t("doctor.check.knowledge_body_dedup.name"),
      status: "ok",
      message: t("doctor.check.knowledge_body_dedup.ok"),
    };
  }
  const fixable = countFixable(inspection.entries);
  const total = inspection.entries.length;
  const first = inspection.entries[0]!;
  const detail = `${first.stable_id} (${first.findings.join(", ")})`;
  return {
    name: t("doctor.check.knowledge_body_dedup.name"),
    status: fixable > 0 ? "error" : "warn",
    kind: fixable > 0 ? "fixable_error" : "warning",
    code: "knowledge_body_dedup",
    fixable: fixable > 0,
    message: t(
      `doctor.check.knowledge_body_dedup.message.${total === 1 ? "singular" : "plural"}`,
      { count: String(total), detail },
    ),
    actionHint: t("doctor.check.knowledge_body_dedup.remediation"),
  };
}

export async function fixBodyDedup(projectRoot: string): Promise<{ fixed: number; skipped: number }> {
  const inspection = await inspectBodyDedup(projectRoot);
  if (inspection.errored || inspection.entries.length === 0) {
    return { fixed: 0, skipped: 0 };
  }
  let fixed = 0;
  let skipped = 0;
  for (const entry of inspection.entries) {
    if (entry.findings.some((f) => f === "body_summary_diverged") &&
        entry.findings.every((f) => f === "body_summary_diverged")) {
      skipped++;
      continue;
    }
    try {
      const raw = await readFile(entry.path, "utf8");
      const rewritten = applyBodyDedupFixes(raw, entry.findings);
      if (rewritten !== raw) {
        await writeFile(entry.path, rewritten, "utf8");
        fixed++;
      }
    } catch {
      skipped++;
    }
  }
  return { fixed, skipped };
}

function parseFlowArray(raw: string): string[] {
  const trimmed = raw.replace(/^['"]|['"]$/gu, "").trim();
  if (!trimmed.startsWith("[")) return [];
  try {
    const arr: unknown = JSON.parse(trimmed);
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function applyTechStackMerge(content: string): string {
  const fmMatch = /^---\n([\s\S]*?)\n---/u.exec(content);
  if (fmMatch === null) return content;
  const fm = fmMatch[1] ?? "";
  const lines = fm.split("\n");

  const tsIdx = lines.findIndex((l) => /^tech_stack:\s/u.test(l));
  if (tsIdx === -1) return content;
  const tsValues = parseFlowArray(lines[tsIdx]!.slice(lines[tsIdx]!.indexOf(":") + 1));

  const tagsIdx = lines.findIndex((l) => /^tags:\s/u.test(l));
  const existingTags = tagsIdx !== -1
    ? parseFlowArray(lines[tagsIdx]!.slice(lines[tagsIdx]!.indexOf(":") + 1))
    : [];
  const merged = [...new Set([...existingTags, ...tsValues])];

  const newLines = lines.filter((_l, i) => i !== tsIdx);
  const newTagsIdx = newLines.findIndex((l) => /^tags:\s/u.test(l));
  if (newTagsIdx !== -1) {
    newLines[newTagsIdx] = `tags: ${JSON.stringify(merged)}`;
  } else {
    const insertAfter = newLines.findIndex((l) => /^(summary|id|type):/u.test(l));
    newLines.splice(insertAfter === -1 ? newLines.length : insertAfter + 1, 0, `tags: ${JSON.stringify(merged)}`);
  }

  return content.replace(fmMatch[1]!, newLines.join("\n"));
}

export function applyBodyDedupFixes(content: string, findings: BodyDedupFinding[]): string {
  let result = content;

  if (findings.includes("body_summary_verbatim") || findings.includes("body_summary_near")) {
    result = result.replace(
      /\n## Summary\s*\n[\s\S]*?(?=\n## |$)/gu,
      "",
    );
  }

  if (findings.includes("body_evidence_redundant")) {
    result = result.replace(
      /\n## Evidence(?:\s*\(call \d+\))?\s*\n[\s\S]*?(?=\n## |$)/gu,
      "",
    );
  }

  if (findings.includes("body_why_proposed_obsolete")) {
    result = result.replace(
      /\n## Why proposed\s*\n[\s\S]*?(?=\n## |$)/gu,
      "",
    );
  }

  if (findings.includes("body_session_context_rename")) {
    result = result.replace(
      /\n## Session context\s*\n/gu,
      "\n## Context\n",
    );
  }

  if (findings.includes("fm_tech_stack_merge")) {
    result = applyTechStackMerge(result);
  }

  result = result.replace(/\n{3,}/gu, "\n\n");
  if (!result.endsWith("\n")) result += "\n";
  return result;
}
