// Recall-time markdown → identity / description derivation.
//
// v2.2 store-only cutover + fallback-purge W1-1: the co-location agents.meta
// build/write surface (buildKnowledgeMeta / writeKnowledgeMeta /
// computeKnowledgeBasedAgentsMeta / computeKnowledgeTestIndex / loadKbIdTypeMap
// / the stableStringify + cache + drift helpers) was retired — stores ship no
// prebuilt agents.meta (their .gitignore excludes it) and the project-local
// `.fabric/agents.meta.json` index is gone. What remains is the pure,
// fs-free derivation the cross-store recall builder + extract-knowledge call to
// turn a store entry's raw markdown frontmatter into a stable_id (deriveRule
// Identity) and a RuleDescription (extractRuleDescription), plus the §4 privacy
// iron-law cross-layer edge guard (isForbiddenCrossLayerEdge).

import {
  deriveAgentsMetaStableId,
  isKnowledgeStableId,
  KnowledgeTypeSchema,
  MaturitySchema,
  parseKnowledgeId,
  StableIdSchema,
  type AgentsIdentitySource,
  type AgentsMeta,
  type KnowledgeType,
  type Layer as KnowledgeLayer,
  type Maturity,
  type RuleDescription,
} from "@fenglimg/fabric-shared";


type NodeMeta = AgentsMeta["nodes"][string];

type RuleIdentity = {
  stableId: string;
  identitySource: AgentsIdentitySource;
};

/**
 * v2.0: Map a content_ref onto a path that legacy `deriveAgentsMeta*` helpers
 * can consume. Both team (`.fabric/knowledge/...`) and personal
 * (`~/.fabric/knowledge/...`) entries collapse to `.fabric/agents/...` so the
 * shared layer/topology helpers can derive a stable answer regardless of
 * which root the file came from. agents.meta.json itself records the
 * original content_ref so consumers can still disambiguate the layer.
 */
function toAgentsCompatiblePath(contentRef: string): string {
  return contentRef
    .replace(/^~\/\.fabric\/knowledge\//u, ".fabric/agents/")
    .replace(/^\.fabric\/knowledge\//u, ".fabric/agents/");
}

// v2.1 global-refactor (W1-T1): exported so the cross-store recall builder can
// derive a store entry's stable_id from its frontmatter with the same logic the
// project meta build uses (path-decoupled id verbatim, deterministic fallback).
export function deriveRuleIdentity(file: string, source: string, existing: NodeMeta | undefined): RuleIdentity {
  // v2.0: Knowledge entries declare a path-decoupled id (KP-/KT-) in their
  // YAML frontmatter `id:` field. When present we use it verbatim and never
  // regenerate from the path — moving a knowledge file between directories
  // must NOT change its stable_id.
  const declaredKnowledgeId = extractDeclaredKnowledgeId(source);
  if (declaredKnowledgeId !== undefined) {
    return {
      stableId: declaredKnowledgeId,
      identitySource: "declared",
    };
  }

  // v2.0: An existing node already carrying a knowledge id (e.g. a prior
  // build before frontmatter was parsable) is also preserved verbatim.
  if (
    existing?.stable_id !== undefined &&
    isKnowledgeStableId(existing.stable_id)
  ) {
    return {
      stableId: existing.stable_id,
      identitySource: "declared",
    };
  }

  const declaredStableId = extractDeclaredStableId(source);
  const derivedStableId = deriveAgentsMetaStableId(toAgentsCompatiblePath(file));

  if (declaredStableId !== undefined) {
    return {
      stableId: declaredStableId,
      identitySource: "declared",
    };
  }

  if (
    existing?.identity_source === "declared" &&
    existing.stable_id !== undefined &&
    existing.stable_id !== derivedStableId
  ) {
    return {
      stableId: existing.stable_id,
      identitySource: "declared",
    };
  }

  return {
    stableId: derivedStableId,
    identitySource: "derived",
  };
}

function extractDeclaredStableId(source: string): string | undefined {
  const match =
    /^(?:\uFEFF)?(?:---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$))?<!--\s*fab:rule-id\s+([A-Za-z0-9][A-Za-z0-9/_-]*)\s*-->\s*(?:\r?\n|$)/u.exec(source);
  return match?.[1];
}

/**
 * v2.0: Extract a path-decoupled knowledge id (KP-/KT-{TYPE}-{NNNN}) from
 * the YAML frontmatter `id:` field. Returns undefined when no frontmatter is
 * present, when `id:` is missing, or when the value does not match the
 * knowledge stable_id pattern.
 *
 * Lightweight regex parser (mirrors the rest of the file's intentionally
 * dependency-free frontmatter handling — see extractDescriptionFromFrontmatter).
 */
function extractDeclaredKnowledgeId(source: string): string | undefined {
  const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u.exec(source);
  if (frontmatter === null) {
    return undefined;
  }
  const idMatch = /^id:\s*(.+?)\s*$/mu.exec(frontmatter[1]);
  if (idMatch === null) {
    return undefined;
  }
  const candidate = idMatch[1].replace(/^["'](.*)["']$/u, "$1").trim();
  return isKnowledgeStableId(candidate) ? candidate : undefined;
}

// v2.1 global-refactor (W1-T1): exported so the cross-store recall builder can
// turn a mounted store's raw markdown frontmatter into the same RuleDescription
// the project meta build produces (stores ship no prebuilt agents.meta — their
// .gitignore excludes it — so candidates must be built from markdown at recall).
export function extractRuleDescription(source: string): RuleDescription | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u.exec(source);
  const description = frontmatter === null
    ? undefined
    : extractDescriptionFromFrontmatter(frontmatter[1]);

  if (description !== undefined) {
    return description;
  }

  const heading = /^#\s+(.+?)\s*$/mu.exec(source);
  const summary = heading?.[1]?.trim();

  // v2.0-rc.22 hotfix (Finding 2 / B1): when frontmatter exists but lacks a
  // `summary:` field (the canonical baseline shape: h1 heading carries the
  // title, knowledge fields live in frontmatter), still pull knowledge
  // fields out of frontmatter rather than emitting all-undefined. Without
  // this, baseline KT-* entries surface in plan-context-hint with empty
  // `type` / `maturity`, which downstream consumers display as ""; only
  // user-promoted entries that author an explicit `summary:` get full
  // knowledge fields. The h1 heading provides the summary; frontmatter
  // provides the rest.
  const knowledge = frontmatter !== null
    ? extractKnowledgeFieldsFromFrontmatter(frontmatter[1])
    : undefined;

  // v2.0.0-rc.27 TASK-002 (audit §2.1/§2.11 fallback hardening): if the
  // entry has an h1 heading, prefer it as the summary. Otherwise — and this
  // is the new rc.27 branch — synthesize a minimal description from
  // frontmatter when the file is "structurally a knowledge entry" (has at
  // least one of: declared id, declared knowledge_type, or non-empty tags).
  //
  // Rationale: rc.26 returned undefined in that case, which caused the
  // entry to be invisible to description_index AND to permanently appear in
  // preflight_diagnostics.missing_description regardless of how many times
  // plan_context's auto-heal ran. The promote pipeline doesn't enforce a
  // summary/h1 on pending files, and historical baseline scans authored
  // many entries without either — so undefined-return is a foot-gun, not a
  // safety net. The minimal description we emit here is intentionally
  // unhelpful for AI consumption (`(unnamed)` summary, empty arrays) so
  // operators still feel the pressure to author proper summaries, but it
  // keeps the entry DISCOVERABLE in description_index instead of silently
  // dropping it.
  const isStructurallyAKnowledgeEntry =
    summary !== undefined && summary.length > 0
      ? true
      : knowledge !== undefined &&
        (knowledge.id !== undefined ||
          knowledge.knowledge_type !== undefined ||
          (knowledge.tags !== undefined && knowledge.tags.length > 0));

  if (!isStructurallyAKnowledgeEntry) {
    // Truly empty file (no h1, no knowledge frontmatter). Preserve
    // pre-rc.27 undefined-return so genuine "this isn't a knowledge entry"
    // cases still trip the diagnostic and operators can investigate.
    return undefined;
  }

  // Choose a summary in priority order: h1 heading → id → derived from tags
  // → static placeholder. `must_read_if` mirrors summary so cite-contract
  // consumers still get a non-empty must_read string.
  const synthesizedSummary =
    summary !== undefined && summary.length > 0
      ? summary
      : knowledge?.id ??
        (knowledge?.tags !== undefined && knowledge.tags.length > 0
          ? `(unnamed; tags: ${knowledge.tags.join(", ")})`
          : "(unnamed knowledge entry)");

  return {
    summary: synthesizedSummary,
    intent_clues: [],
    tech_stack: [],
    impact: [],
    must_read_if: synthesizedSummary,
    // v2.0-rc.22: when frontmatter is present, merge its knowledge fields;
    // when fully absent (no `---` block), all knowledge fields stay
    // undefined, matching the original heading-only fallback contract.
    id: knowledge?.id,
    knowledge_type: knowledge?.knowledge_type,
    maturity: knowledge?.maturity,
    // W4/Track1 (D1): no `knowledge_layer` — layer derives from the id prefix.
    created_at: knowledge?.created_at,
    tags: knowledge?.tags,
    // v2.0-rc.5 (C1): default-safe values when there is no frontmatter at all;
    // when frontmatter exists, honor its declared values (extractKnowledge
    // FieldsFromFrontmatter already applies the broad-default for missing
    // or malformed scopes).
    relevance_scope: knowledge?.relevance_scope ?? "broad",
    relevance_paths: knowledge?.relevance_paths ?? [],
    // v2.2 H2-related (W1-T7): graph edges, undefined when absent.
    related: knowledge?.related,
  };
}

function extractDescriptionFromFrontmatter(frontmatter: string): RuleDescription | undefined {
  const summary = extractScalar(frontmatter, "summary") ?? extractScalar(frontmatter, "description");
  if (summary === undefined) {
    return undefined;
  }

  const knowledge = extractKnowledgeFieldsFromFrontmatter(frontmatter);

  return {
    summary,
    intent_clues: extractInlineArray(frontmatter, "intent_clues"),
    tech_stack: extractInlineArray(frontmatter, "tech_stack"),
    impact: extractInlineArray(frontmatter, "impact"),
    must_read_if: extractScalar(frontmatter, "must_read_if") ?? summary,
    id: knowledge.id,
    knowledge_type: knowledge.knowledge_type,
    maturity: knowledge.maturity,
    // W4/Track1 (D1): no `knowledge_layer` — layer derives from the id prefix.
    created_at: knowledge.created_at,
    tags: knowledge.tags,
    relevance_scope: knowledge.relevance_scope,
    relevance_paths: knowledge.relevance_paths,
    // v2.2 H2-related (W1-T7): graph edges parsed from frontmatter.
    related: knowledge.related,
  };
}

/**
 * v2.0 knowledge frontmatter parser. All fields optional + best-effort —
 * invalid values log a warning and remain undefined; parsing never throws,
 * so v1.x frontmatter (lacking these fields) flows through unchanged.
 *
 * Cross-validation: declared id implies a layer (KP→personal, KT→team).
 * If id and layer disagree, we drop both to avoid a corrupt half-state.
 */
type KnowledgeFrontmatterFields = {
  id?: string;
  knowledge_type?: KnowledgeType;
  maturity?: Maturity;
  // W4/Track1 (D1): no `knowledge_layer` — the entry's layer is a pure function
  // of its id prefix (KP-→personal, else team; KT-DEC-0004). The frontmatter
  // `layer:` field is validated separately by doctor's knowledge_layer_mismatch
  // lint (id vs store location); the meta builder no longer parses it.
  created_at?: string;
  // v2/rc.2: flat flow-style YAML array; populated by init-scan from forensic
  // tech-stack keywords and editable by user.
  tags?: string[];
  // v2.0-rc.5 (C1): relevance scope/paths drive plan-context-hint narrowing.
  // Defaults applied at the parse layer when fields are absent or malformed:
  //   relevance_scope → 'broad'   (always-surface, the safe default)
  //   relevance_paths → []        (no path anchors; broad scope ignores them)
  // Default-safe semantics keep the existing 16 canonical entries valid
  // without requiring frontmatter migration.
  relevance_scope: "narrow" | "broad";
  relevance_paths: string[];
  // v2.2 H2-related (W1-T7): graph edges to related KB entries by stable_id.
  // Parsed from a flow-style inline array `related: [KT-DEC-0001, ...]`. Absent
  // or empty → undefined (mirrors tags), so the field is purely additive.
  related?: string[];
};

// lifecycle-refactor W3-A1 (§4 privacy iron law): KT→KP topology leak guard.
//
// The project's PHYSICAL directory (./.fabric/, incl. agents.meta.json) must
// NEVER carry a personal (KP-*) behavioural fingerprint or topology edge. A
// `related` graph edge whose SOURCE is a team (KT-*) entry but whose TARGET is
// a personal (KP-*) id would write a team→personal pointer into the project
// account ledger — leaking the existence/shape of someone's personal knowledge
// graph into the shared repo. That edge is forbidden and stripped here.
//
// Allowed (returns false): KT→KT, KP→KP, KP→KT. Forbidden (returns true):
// KT→KP only. The source layer is whatever the entry resolves to (KT prefix /
// team layer); the target layer is decoded from the related id's KP/KT prefix.
// A target id that is not stable-id-shaped (parseKnowledgeId → null) is NOT a
// cross-layer leak by construction (no decodable personal target) → allowed
// through unchanged, matching the additive "best-effort, never widen rejection"
// contract.
//
// Single auditable landing point: every `related` array — from BOTH the
// frontmatter-description path and the heading-fallback path — flows through
// extractKnowledgeFieldsFromFrontmatter, so filtering here covers the whole
// meta-build surface in one place.
export function isForbiddenCrossLayerEdge(
  sourceLayer: KnowledgeLayer | undefined,
  targetId: string,
): boolean {
  // Only team-sourced edges can leak INTO the project ledger; a personal-layer
  // source writes to ~/.fabric (never the project physical dir), so KP→anything
  // is allowed.
  if (sourceLayer !== "team") {
    return false;
  }
  const decoded = parseKnowledgeId(localKnowledgeIdFromReference(targetId));
  if (decoded === null) {
    return false;
  }
  return decoded.layer === "personal";
}

function localKnowledgeIdFromReference(ref: string): string {
  const direct = parseKnowledgeId(ref);
  if (direct !== null) {
    return ref;
  }
  const tail = ref.split(":").at(-1);
  return tail ?? ref;
}

function extractKnowledgeFieldsFromFrontmatter(frontmatter: string): KnowledgeFrontmatterFields {
  const rawId = extractScalar(frontmatter, "id");
  const rawType = extractScalar(frontmatter, "type");
  const rawMaturity = extractScalar(frontmatter, "maturity");
  const rawCreatedAt = extractScalar(frontmatter, "created_at");

  let id: string | undefined;
  if (rawId !== undefined) {
    const parsed = StableIdSchema.safeParse(rawId);
    if (parsed.success) {
      id = parsed.data;
    } else {
      process.stderr.write(`[fabric] frontmatter: invalid knowledge id format ${JSON.stringify(rawId)}; skipping\n`);
    }
  }

  // rc.29 BUG-C1: legacy singular → canonical plural normalizer. Disk corpora
  // pre-dating the unification may carry `type: decision` (singular); the
  // canonical schema is now plural. Map legacy values up before safeParse so
  // those entries are accepted instead of silently dropped.
  const SINGULAR_TO_PLURAL = {
    model: "models",
    decision: "decisions",
    guideline: "guidelines",
    pitfall: "pitfalls",
    process: "processes",
  } as const;

  let knowledge_type: KnowledgeType | undefined;
  if (rawType !== undefined) {
    const normalized =
      SINGULAR_TO_PLURAL[rawType as keyof typeof SINGULAR_TO_PLURAL] ?? rawType;
    const parsed = KnowledgeTypeSchema.safeParse(normalized);
    if (parsed.success) {
      knowledge_type = parsed.data;
    } else {
      process.stderr.write(`[fabric] frontmatter: unknown knowledge type ${JSON.stringify(rawType)}; skipping\n`);
    }
  }

  let maturity: Maturity | undefined;
  if (rawMaturity !== undefined) {
    const parsed = MaturitySchema.safeParse(rawMaturity);
    if (parsed.success) {
      maturity = parsed.data;
    } else {
      process.stderr.write(`[fabric] frontmatter: unknown maturity ${JSON.stringify(rawMaturity)}; skipping\n`);
    }
  }

  let created_at: string | undefined;
  if (rawCreatedAt !== undefined) {
    if (!Number.isNaN(Date.parse(rawCreatedAt))) {
      created_at = rawCreatedAt;
    } else {
      process.stderr.write(`[fabric] frontmatter: malformed created_at ${JSON.stringify(rawCreatedAt)}; skipping\n`);
    }
  }

  // W4/Track1 (D1): the old id-vs-`layer` cross-validation is gone with the
  // `knowledge_layer` field — the id prefix IS the single source of truth for
  // layer (KT-DEC-0004), so there is nothing to disagree with here. The residual
  // integrity check (a KP-*/KT-* id sitting in the wrong physical store) is owned
  // by doctor's knowledge_layer_mismatch lint (id vs store location).

  // v2/rc.2: tags — flat flow-style YAML inline array e.g. `tags: [ts, react]`
  const tags = extractInlineArray(frontmatter, "tags");

  // v2.0-rc.5 (C1): relevance_scope — case-sensitive scalar (narrow|broad).
  // Anything else (missing key, mistyped value, leading whitespace within a
  // quoted form) falls back to 'broad'. Defaults are forgiving so the 16
  // canonical entries that pre-date the field still parse cleanly.
  const rawRelevanceScope = extractScalar(frontmatter, "relevance_scope");
  const relevance_scope: "narrow" | "broad" =
    rawRelevanceScope === "narrow" || rawRelevanceScope === "broad"
      ? rawRelevanceScope
      : "broad";

  // v2.0-rc.5 (C1): relevance_paths — flow-style inline YAML array e.g.
  // `relevance_paths: [src/foo.ts, src/bar/]`. Absent or malformed → [].
  // Reuses extractInlineArray (the same helper used for tags / tech_stack /
  // intent_clues), so a missing key returns [] without warning.
  const relevance_paths = extractInlineArray(frontmatter, "relevance_paths");

  // v2.2 H2-related (W1-T7): related — flow-style inline array of stable_ids.
  // Reuses extractInlineArray like tags; absent/empty → undefined.
  const rawRelated = extractInlineArray(frontmatter, "related");

  // lifecycle-refactor W3-A1 (§4 privacy iron law): strip KT→KP topology edges
  // before they ever reach agents.meta.json. The source layer is the entry's own
  // layer — W4/Track1 (D1) derives it purely from the id prefix (KT→team /
  // KP→personal; KT-DEC-0004), the single source of truth. The redundant
  // `knowledge_layer` field is gone, so there is no field to prefer over the id.
  //
  // FAIL-SAFE default: when an entry declares NO layer-encoding `id`, we treat
  // the source as `team`. The iron law protects the project's physical ledger,
  // and this default can only ever strip MORE potential leaks, never manufacture
  // one: a genuinely personal entry always carries a KP-* id (id late-bound at
  // approve), so its source resolves to personal and its KP→KP / KP→KT edges pass
  // through untouched. An unlabeled entry carrying a `related: [KP-*]` edge is
  // exactly the leak shape we must refuse by default.
  //
  // A target KP-* id on a team-sourced entry is a leak (see
  // isForbiddenCrossLayerEdge): it is dropped from the persisted edge set and a
  // best-effort stderr diagnostic records the stripped edge (mirrors the
  // existing frontmatter warning convention in this parser). KT→KT / KP→KT /
  // KP→KP pass through.
  const sourceLayer: KnowledgeLayer =
    id !== undefined ? parseKnowledgeId(id)?.layer ?? "team" : "team";
  const related = rawRelated.filter((targetId) => {
    if (isForbiddenCrossLayerEdge(sourceLayer, targetId)) {
      process.stderr.write(
        `[fabric] frontmatter: stripping forbidden cross-layer related edge ${
          id ?? "(team entry)"
        } → ${targetId} (KT→KP topology leak; §4 privacy iron law)\n`,
      );
      return false;
    }
    return true;
  });

  return {
    id,
    knowledge_type,
    maturity,
    created_at,
    tags: tags.length > 0 ? tags : undefined,
    relevance_scope,
    relevance_paths,
    related: related.length > 0 ? related : undefined,
  };
}

function extractScalar(frontmatter: string, key: string): string | undefined {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "mu");
  const match = pattern.exec(frontmatter);
  if (match === null) {
    return undefined;
  }

  return unquote(match[1].trim());
}

function extractInlineArray(frontmatter: string, key: string): string[] {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*\\[(.*?)\\]\\s*$`, "mu");
  const match = pattern.exec(frontmatter);
  if (match === null) {
    return [];
  }

  return match[1]
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter((item) => item.length > 0);
}

function unquote(value: string): string {
  return value.replace(/^["'](.*)["']$/u, "$1");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
