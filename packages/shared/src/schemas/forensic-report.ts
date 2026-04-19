import { z } from "zod";

export interface ForensicCodeSample {
  path: string;
  lines: string;
  snippet: string;
  pattern_hint: string;
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
  readme: ForensicReadme;
  recommendations_for_skill: string[];
}

export const forensicCodeSampleSchema = z.object({
  path: z.string(),
  lines: z.string(),
  snippet: z.string(),
  pattern_hint: z.string(),
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
  readme: forensicReadmeSchema,
  recommendations_for_skill: z.array(z.string()),
});
