// v2.0.0-rc.24 TASK-05: L1 Stop hook soft reminder for missing cite contract.
//
// Reads `.fabric/agents.meta.json` to build a stable_id → knowledge_type lookup
// map, then scans summarised assistant turns (cite_ids + cite_tags +
// cite_commitments parallel arrays produced by lib/cite-line-parser.cjs) for
// turns that cited a decision-class or pitfall-class id with [recalled] tag
// but no operator commitment and no skip:<reason>.
//
// Emits one reminder line per offending id (deduplicated across the turn
// summary). Non-blocking — caller writes the lines to stderr; failure to
// load the meta file or absence of offenders means zero output.
//
// Reminder template (rc.24 lock B2 / L1 enforcement layer):
//   ⚠ KB: <id> cited as [recalled] but missing contract; add → edit:<glob>
//     or → skip:<reason> next turn
//
// Type filter rationale: only `decision` and `pitfall` types are contract-
// required per rc.24 design lock B6 (idTypeMap routing). `model`,
// `guideline`, `process` use reference-cite or LLM-judge (deferred to rc.25+)
// and are intentionally skipped here to avoid false-positive nudges.
//
// agents.meta.json schema note: `description.knowledge_type` values are
// SINGULAR (`decision`, `pitfall`, `model`, `guideline`, `process`) per
// packages/shared/src/schemas/agents-meta.ts. The reminder filter normalises
// any plural input defensively but the canonical contract is singular.
//
// Reading happens once per hook invocation (caller passes the projectRoot;
// the lib does the fs read internally). The map is small (<200 entries in
// typical corpora) so caching beyond the per-invocation scope is unnecessary.

const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const FABRIC_DIR = ".fabric";
const AGENTS_META_FILE = "agents.meta.json";

// Knowledge types that require contract commitments on [recalled] cites.
// Matches the singular form persisted by `withDerivedAgentsMetaNodeDefaults`
// in packages/shared/src/schemas/agents-meta.ts. We accept both singular
// and plural defensively so a future schema change to plurals doesn't
// silently break the filter.
const CONTRACT_REQUIRED_TYPES = new Set([
  "decision",
  "decisions",
  "pitfall",
  "pitfalls",
]);

/**
 * Build a Map<stable_id, knowledge_type> from <projectRoot>/.fabric/agents.meta.json.
 *
 * Never throws — missing file, malformed JSON, missing nodes key, etc. all
 * yield an empty Map. The caller's downstream filter then becomes a no-op
 * (no id resolves → no reminders).
 *
 * @param {string} projectRoot - workspace root
 * @returns {Map<string, string>} stable_id → knowledge_type (singular)
 */
function readKnowledgeTypeMap(projectRoot) {
  const out = new Map();
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return out;

  const metaPath = join(projectRoot, FABRIC_DIR, AGENTS_META_FILE);
  if (!existsSync(metaPath)) return out;

  let raw;
  try {
    raw = readFileSync(metaPath, "utf8");
  } catch {
    return out;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }

  if (parsed === null || typeof parsed !== "object") return out;
  const nodes = parsed.nodes;
  if (nodes === null || typeof nodes !== "object") return out;

  for (const [id, node] of Object.entries(nodes)) {
    if (node === null || typeof node !== "object") continue;
    const description = node.description;
    if (description === null || typeof description !== "object") continue;
    const kt = description.knowledge_type;
    if (typeof kt !== "string" || kt.length === 0) continue;
    out.set(id, kt);
  }

  return out;
}

/**
 * Scan parsed assistant turns for cites that should have a contract but
 * don't, returning the reminder lines to emit.
 *
 * Filter (all must hold for a given index i within a turn):
 *   1. cite_tags includes "recalled" (turn-level — applies to the cited id)
 *   2. cite_commitments[i].operators is empty AND cite_commitments[i].skip_reason is null
 *   3. idTypeMap.get(cite_ids[i]) is in {decision, pitfall}
 *
 * Tag-level filter clarification: rc.20 cite_tags is parallel to ALL parsed
 * lines (including sentinels), but for the contract-missing reminder we use
 * the turn-level semantic — if the assistant tagged the cite as [recalled],
 * the operator-or-skip contract applies. Per TASK-04 invariant, cite_ids and
 * cite_commitments are parallel index-aligned arrays (length-N each).
 *
 * Sentinel turns (cite_ids=[], cite_tags=["none"]) contribute no offenders
 * because the cite_ids loop has zero iterations.
 *
 * Offenders are deduplicated by id across the entire turn array; multiple
 * turns citing the same id yield ONE reminder line.
 *
 * @param {Object} args
 * @param {Array<{cite_ids: string[], cite_tags: string[], cite_commitments: Array<{operators: Array<unknown>, skip_reason: string|null}>}>} args.assistant_turns
 * @param {Map<string, string>} args.idTypeMap
 * @returns {string[]} reminder lines (empty when no offenders)
 */
function formatContractMissingReminders({ assistant_turns, idTypeMap }) {
  if (!Array.isArray(assistant_turns) || assistant_turns.length === 0) return [];
  if (!(idTypeMap instanceof Map) || idTypeMap.size === 0) return [];

  const offenders = new Set();

  for (const turn of assistant_turns) {
    if (turn === null || typeof turn !== "object") continue;
    const citeIds = Array.isArray(turn.cite_ids) ? turn.cite_ids : [];
    const citeTags = Array.isArray(turn.cite_tags) ? turn.cite_tags : [];
    const commitments = Array.isArray(turn.cite_commitments) ? turn.cite_commitments : [];

    // Turn-level: the [recalled] tag must appear in the turn's tag set.
    if (!citeTags.includes("recalled")) continue;

    // Iterate by cite_ids.length — sentinel entries don't have ids so they
    // contribute zero iterations even if cite_tags carries "none".
    for (let i = 0; i < citeIds.length; i += 1) {
      const id = citeIds[i];
      if (typeof id !== "string" || id.length === 0) continue;

      const type = idTypeMap.get(id);
      if (!CONTRACT_REQUIRED_TYPES.has(type)) continue;

      const commitment = commitments[i];
      if (commitment === null || typeof commitment !== "object") continue;
      const operators = Array.isArray(commitment.operators) ? commitment.operators : [];
      const skipReason = commitment.skip_reason;
      const hasContract = operators.length > 0 || (typeof skipReason === "string" && skipReason.length > 0);
      if (hasContract) continue;

      offenders.add(id);
    }
  }

  if (offenders.size === 0) return [];

  // Stable order: insertion order is the order ids first appeared across turns.
  const reminders = [];
  for (const id of offenders) {
    reminders.push(
      `⚠ KB: ${id} cited as [recalled] but missing contract; add \`→ edit:<glob>\` or \`→ skip:<reason>\` next turn`,
    );
  }
  return reminders;
}

module.exports = {
  readKnowledgeTypeMap,
  formatContractMissingReminders,
  CONTRACT_REQUIRED_TYPES,
};
