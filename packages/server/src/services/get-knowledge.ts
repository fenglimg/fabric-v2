/**
 * get-knowledge.ts — path normalization helper.
 *
 * v2.2 W5 R2 (agents.meta decolo): the path-glob co-location injection model
 * (`getKnowledge` / `loadGetKnowledgeContext` / `resolveKnowledgeForPath` /
 * `matchRuleNodes` / `classifyNode` + their payload helpers) has been retired.
 * It read the co-location `agents.meta.json` (via `readAgentsMeta` /
 * `loadActiveMeta`) and matched rule nodes by `scope_glob` against a requested
 * path — a model with no remaining consumer (the MCP read tools cut over to the
 * cross-store recall model, and the only `getKnowledge` caller was the
 * quarantined server-http-experimental package).
 *
 * `normalizeKnowledgePath` is preserved because `plan-context.ts` still uses it
 * for slash-only path normalization.
 */

export function normalizeKnowledgePath(value: string): string {
  return value.replaceAll("\\", "/");
}
