import { z } from "zod";

export interface InitContextFramework {
  kind: string;
  version: string;
  subkind: string;
}

export interface InitContextInvariantConfidenceSnapshot {
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence_refs: string[];
}

export interface InitContextSourceEvidence {
  file: string;
  lines: string;
}

export interface InitContextInvariant {
  type: "ban" | "require" | "protect";
  rule: string;
  rationale?: string;
  confidence_snapshot?: InitContextInvariantConfidenceSnapshot;
  source_evidence?: InitContextSourceEvidence[];
}

export interface InitContextDomainGroup {
  name: string;
  paths: string[];
  summary?: string;
  topology_type?: "mirror" | "cross-cutting";
  target_path?: string;
}

export interface InitContextInterviewTrailEntry {
  phase: string;
  question: string;
  answer: string;
  presentation?: string;
  user_corrections?: string[];
}

export interface InitContext {
  framework: InitContextFramework;
  architecture_patterns: string[];
  invariants: InitContextInvariant[];
  domain_groups: InitContextDomainGroup[];
  interview_trail: InitContextInterviewTrailEntry[];
  forensic_ref: string;
}

export const initContextFrameworkSchema = z.object({
  kind: z.string(),
  version: z.string(),
  subkind: z.string(),
});

export const initContextInvariantConfidenceSnapshotSchema = z.object({
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  evidence_refs: z.array(z.string()),
});

export const initContextSourceEvidenceSchema = z.object({
  file: z.string(),
  lines: z.string(),
});

export const initContextInvariantSchema = z.object({
  type: z.enum(["ban", "require", "protect"]),
  rule: z.string(),
  rationale: z.string().optional(),
  confidence_snapshot: initContextInvariantConfidenceSnapshotSchema.optional(),
  source_evidence: z.array(initContextSourceEvidenceSchema).optional(),
});

export const initContextDomainGroupSchema = z.object({
  name: z.string(),
  paths: z.array(z.string()),
  summary: z.string().optional(),
  topology_type: z.enum(["mirror", "cross-cutting"]).optional(),
  target_path: z.string().optional(),
});

export const initContextInterviewTrailEntrySchema = z.object({
  phase: z.string(),
  question: z.string(),
  answer: z.string(),
  presentation: z.string().optional(),
  user_corrections: z.array(z.string()).optional(),
});

export const initContextSchema = z.object({
  framework: initContextFrameworkSchema,
  architecture_patterns: z.array(z.string()),
  invariants: z.array(initContextInvariantSchema),
  domain_groups: z.array(initContextDomainGroupSchema),
  interview_trail: z.array(initContextInterviewTrailEntrySchema),
  forensic_ref: z.string(),
});
