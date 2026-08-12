// Tokens that AI clients consume verbatim from Fabric prompts (SKILL.md, the
// bootstrap body, recall payloads). They MUST survive translation and
// paraphrasing across locales — if a maintainer or an LLM-assisted edit rewrites
// `fab_recall` as "召回" or weakens `MUST` to "应该", the protocol breaks
// silently with no error anywhere.
//
// This registry is the vocabulary that must NOT be translated. It is not a
// "these strings must appear" checklist — scripts/lint-protected-tokens.ts
// enforces verbatim presence in the shipped SKILL.md files, and
// bootstrap-parity.test.ts does the same for the bootstrap body against its own
// up-to-date list.
//
// A token retired in doctor-retired-references-lint's RETIRED_TOKENS must NEVER
// appear here — protecting a dead token means pinning rot in place. That
// invariant is asserted in packages/server (which can see both registries).

export const PROTECTED_TOKENS = [
  // MCP tool names
  "fab_recall",
  "fab_propose",
  "fab_review",
  // Project convergence point + knowledge tree paths
  "AGENTS.md",
  ".fabric/events.jsonl",
  "knowledge/pending",
  // Event types templates reference verbatim
  "knowledge_proposed",
  // fabric-archive contract surface
  "relevance_scope",
  "relevance_paths",
  // Scope enum values
  "narrow",
  "broad",
  // fab_propose contract fields
  "source_sessions",
  "proposed_reason",
  "session_context",
  // Layer enum values + pending output path key
  "layer",
  "team",
  "personal",
  "pending_path",
  // Server event emitted when personal layer auto-degrades narrow → broad
  "knowledge_scope_degraded",
  // Human-lock marker, referenced verbatim by the scan recommendations in both
  // locales (see scan.rec.cocos.* in locales/en.ts and locales/zh-CN.ts).
  "@HUMAN",
  // Hard-rule keywords AI clients rely on for compliance
  "MUST",
  "NEVER",
] as const;

export type ProtectedToken = (typeof PROTECTED_TOKENS)[number];
