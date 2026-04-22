import { z } from "zod";

export interface ForensicCodeSample {
  path: string;
  lines: string;
  snippet: string;
  pattern_hint: string;
}

export interface ForensicEvidenceAnchor {
  file: string;
  line: string;
  snippet: string;
}

export interface ForensicAssertionCoverage {
  ratio: number;
  total: number;
  matched: number;
  co_occurring_patterns: string[];
}

export type ForensicAssertionType = "framework" | "pattern" | "invariant" | "domain";
export type ForensicAssertionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ForensicAssertion {
  type: ForensicAssertionType;
  statement: string;
  confidence: ForensicAssertionConfidence;
  evidence: ForensicEvidenceAnchor[];
  coverage: ForensicAssertionCoverage;
  proposed_rule?: string;
  alternatives?: string[];
}

export interface ForensicTopology {
  total_files: number;
  by_ext: Record<string, number>;
  key_dirs: string[];
  max_depth: number;
}

export interface ForensicEntryPoint {
  path: string;
  reason: string;
  size_bytes?: number;
}

export interface ForensicFramework {
  kind: string;
  version: string;
  subkind: string;
  evidence: string[];
}

export interface ForensicReadme {
  quality: "missing" | "stub" | "ok";
  line_count: number;
  has_contributing: boolean;
}

export type CandidateFileFamily = "entry" | "component" | "config" | "test" | "domain";

export interface CandidateFileEntry {
  path: string;
  family: CandidateFileFamily;
  rationale: string;
}

export interface ForensicSamplingBudget {
  max_files: 15;
  max_lines_per_file: 100;
}

export interface ForensicReport {
  version: string;
  generated_at: string;
  generated_by: string;
  target: string;
  project_name: string;
  framework: ForensicFramework;
  topology: ForensicTopology;
  entry_points: ForensicEntryPoint[];
  code_samples: ForensicCodeSample[];
  assertions: ForensicAssertion[];
  candidate_files: CandidateFileEntry[];
  sampling_budget: ForensicSamplingBudget;
  readme: ForensicReadme;
  /** @deprecated Transitional migration field. Prefer assertions[]. */
  recommendations_for_skill?: string[];
}

export const forensicCodeSampleSchema = z.object({
  path: z.string(),
  lines: z.string(),
  snippet: z.string(),
  pattern_hint: z.string(),
});

export const forensicEvidenceAnchorSchema = z.object({
  file: z.string(),
  line: z.string(),
  snippet: z.string(),
});

export const forensicAssertionCoverageSchema = z.object({
  ratio: z.number().min(0).max(1),
  total: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  co_occurring_patterns: z.array(z.string()),
});

export const forensicAssertionSchema = z.object({
  type: z.enum(["framework", "pattern", "invariant", "domain"]),
  statement: z.string(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  evidence: z.array(forensicEvidenceAnchorSchema),
  coverage: forensicAssertionCoverageSchema,
  proposed_rule: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
});

export const forensicTopologySchema = z.object({
  total_files: z.number().int().nonnegative(),
  by_ext: z.record(z.number().int().nonnegative()),
  key_dirs: z.array(z.string()),
  max_depth: z.number().int().nonnegative(),
});

export const forensicEntryPointSchema = z.object({
  path: z.string(),
  reason: z.string(),
  size_bytes: z.number().int().nonnegative().optional(),
});

export const forensicFrameworkSchema = z.object({
  kind: z.string(),
  version: z.string(),
  subkind: z.string(),
  evidence: z.array(z.string()),
});

export const forensicReadmeSchema = z.object({
  quality: z.enum(["missing", "stub", "ok"]),
  line_count: z.number().int().nonnegative(),
  has_contributing: z.boolean(),
});

export const candidateFileEntrySchema = z.object({
  path: z.string(),
  family: z.enum(["entry", "component", "config", "test", "domain"]),
  rationale: z.string(),
});

export const forensicSamplingBudgetSchema = z.object({
  max_files: z.literal(15),
  max_lines_per_file: z.literal(100),
});

export const forensicReportSchema = z.object({
  version: z.string(),
  generated_at: z.string(),
  generated_by: z.string(),
  target: z.string(),
  project_name: z.string(),
  framework: forensicFrameworkSchema,
  topology: forensicTopologySchema,
  entry_points: z.array(forensicEntryPointSchema),
  code_samples: z.array(forensicCodeSampleSchema),
  assertions: z.array(forensicAssertionSchema),
  candidate_files: z.array(candidateFileEntrySchema),
  sampling_budget: forensicSamplingBudgetSchema,
  readme: forensicReadmeSchema,
  recommendations_for_skill: z.array(z.string()).optional(),
});
