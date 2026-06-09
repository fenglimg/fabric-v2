// Tokens that AI clients consume verbatim from Fabric prompts (bootstrap
// templates, SKILL.md, runtime fab_get_knowledge_sections payloads). They
// MUST survive translation/paraphrasing across locales — if a maintainer or
// LLM-assisted edit rewrites `fab_plan_context` as "计划上下文" or weakens
// `MUST` to "应该", the protocol breaks silently. scripts/lint-protected-tokens.ts
// enforces verbatim presence in templates; the i18n integration test enforces
// registry membership.

export const PROTECTED_TOKENS = [
  // v2.0 MCP tool names
  "fab_recall",
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
  // fabric-archive Phase 1.5 contract surface (rc.9 — bare `scope` was renamed)
  "relevance_scope",
  "relevance_paths",
  // Phase 1.5 scope enum values (rc.9 — TASK-008 D1)
  "narrow",
  "broad",
  // v2.0.0-rc.7 T5/T6 fab_extract_knowledge contract fields (TASK-008 D1)
  "source_sessions",
  "proposed_reason",
  "session_context",
  // Layer enum values + pending output path key (TASK-008 D1)
  "layer",
  "team",
  "personal",
  "pending_path",
  // Server event emitted when personal layer auto-degrades narrow → broad (TASK-008 D1)
  "knowledge_scope_degraded",
  // Human-lock marker
  "@HUMAN",
  // Hard-rule keywords AI clients rely on for compliance
  "MUST",
  "NEVER",
] as const;

export type ProtectedToken = (typeof PROTECTED_TOKENS)[number];
