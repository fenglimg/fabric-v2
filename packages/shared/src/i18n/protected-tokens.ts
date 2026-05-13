// Tokens that AI clients consume verbatim from Fabric prompts (bootstrap
// templates, SKILL.md, runtime fab_get_knowledge_sections payloads). They
// MUST survive translation/paraphrasing across locales — if a maintainer or
// LLM-assisted edit rewrites `fab_plan_context` as "计划上下文" or weakens
// `MUST` to "应该", the protocol breaks silently. scripts/lint-protected-tokens.ts
// enforces verbatim presence in templates; the i18n integration test enforces
// registry membership.

export const PROTECTED_TOKENS = [
  // v2.0 MCP tool names
  "fab_plan_context",
  "fab_get_knowledge_sections",
  "fab_extract_knowledge",
  "fab_review",
  // Project convergence point + knowledge tree paths
  "AGENTS.md",
  ".fabric/agents/",
  ".fabric/agents/_cross/",
  ".fabric/agents.meta.json",
  ".fabric/human-lock.json",
  ".fabric/events.jsonl",
  ".fabric/knowledge/",
  // Event types templates reference verbatim
  "knowledge_proposed",
  // Human-lock marker
  "@HUMAN",
  // Hard-rule keywords AI clients rely on for compliance
  "MUST",
  "NEVER",
] as const;

export type ProtectedToken = (typeof PROTECTED_TOKENS)[number];
