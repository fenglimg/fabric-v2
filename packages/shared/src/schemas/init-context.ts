import { z } from "zod";

export interface InitContextFramework {
  kind: string;
  version: string;
  subkind: string;
}

export interface InitContextInvariant {
  type: "ban" | "require" | "protect";
  rule: string;
  rationale?: string;
}

export interface InitContextDomainGroup {
  name: string;
  paths: string[];
  summary?: string;
}

export interface InitContextInterviewTrailEntry {
  phase: string;
  question: string;
  answer: string;
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

export const initContextInvariantSchema = z.object({
  type: z.enum(["ban", "require", "protect"]),
  rule: z.string(),
  rationale: z.string().optional(),
});

export const initContextDomainGroupSchema = z.object({
  name: z.string(),
  paths: z.array(z.string()),
  summary: z.string().optional(),
});

export const initContextInterviewTrailEntrySchema = z.object({
  phase: z.string(),
  question: z.string(),
  answer: z.string(),
});

export const initContextSchema = z.object({
  framework: initContextFrameworkSchema,
  architecture_patterns: z.array(z.string()),
  invariants: z.array(initContextInvariantSchema),
  domain_groups: z.array(initContextDomainGroupSchema),
  interview_trail: z.array(initContextInterviewTrailEntrySchema),
  forensic_ref: z.string(),
});
