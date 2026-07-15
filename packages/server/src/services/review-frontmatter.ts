/**
 * ISS-20260713-013: frontmatter parse/rewrite helpers extracted from review.ts.
 */
import type { KnowledgeType } from "@fenglimg/fabric-shared/schemas/api-contracts";

type PluralType = KnowledgeType;

const PLURAL_TYPES: ReadonlyArray<PluralType> = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];

// Mirror review.ts SCOPE_COORDINATE_PATTERN if used
const SCOPE_COORDINATE_PATTERN = /^(?:personal|team|project:[a-z0-9][a-z0-9_-]*)$/u;

type Layer = "team" | "personal";
type Maturity = "draft" | "verified" | "proven";
type RelevanceScope = "narrow" | "broad";
type LifecycleStatus = "active" | "rejected" | "deferred";

export type ParsedFrontmatter = {
  id?: string;
  type?: PluralType;
  layer?: Layer;
  maturity?: Maturity;
  source_session?: string;
  created_at?: string;
  tags?: string[];
  title?: string;
  summary?: string;
  proposed_reason?: string;
  relevance_scope?: RelevanceScope;
  relevance_paths?: string[];
  semantic_scope?: string;
  status?: LifecycleStatus;
  deferred_until?: string;
  last_review_confirmed_at?: string;
  deprecated?: boolean;
  superseded_by?: string;
};

export type ModifyChanges = Omit<
  FrontmatterScalarPatch,
  "status" | "deferred_until" | "last_review_confirmed_at" | "deprecated" | "superseded_by" | "type"
>;

export type FrontmatterScalarPatch = {
  title?: string;
  summary?: string;
  layer?: Layer;
  maturity?: Maturity;
  tags?: string[];
  relevance_scope?: RelevanceScope;
  relevance_paths?: string[];
  semantic_scope?: string;
  related?: string[];
  must_read_if?: string;
  intent_clues?: string[];
  impact?: string[];
  tech_stack?: string[];
  evidence_paths?: string[];
  onboard_slot?:
    | "tech-stack-decision"
    | "architecture-pattern"
    | "code-style-tone"
    | "build-system-idiom"
    | "domain-vocabulary";
  status?: LifecycleStatus;
  deferred_until?: string;
  last_review_confirmed_at?: string;
  deprecated?: boolean;
  superseded_by?: string;
  type?: PluralType;
};

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u.exec(content);
  if (match === null) {
    return {};
  }
  const block = match[1];
  if (block === undefined) {
    return {};
  }

  const out: ParsedFrontmatter = {};

  for (const rawLine of block.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();

    switch (key) {
      case "id":
        out.id = stripQuotes(value);
        break;
      case "type":
        if (PLURAL_TYPES.includes(value as PluralType)) {
          out.type = value as PluralType;
        }
        break;
      case "layer":
        if (value === "team" || value === "personal") {
          out.layer = value;
        }
        break;
      case "maturity":
        if (value === "draft" || value === "verified" || value === "proven") {
          out.maturity = value;
        }
        break;
      case "source_session":
        out.source_session = stripQuotes(value);
        break;
      case "created_at":
        out.created_at = stripQuotes(value);
        break;
      case "tags":
        out.tags = parseFlowArray(value);
        break;
      case "title":
        out.title = stripQuotes(value);
        break;
      case "proposed_reason":
        out.proposed_reason = stripQuotes(value);
        break;
      case "summary":
        out.summary = stripQuotes(value);
        break;
      case "relevance_scope":
        // v2.0-rc.5 C3: strict allow-list; anything else → leave field absent
        // so consumers fall back to broad default (matches knowledge-meta-builder).
        if (value === "narrow" || value === "broad") {
          out.relevance_scope = value;
        }
        break;
      case "relevance_paths":
        // v2.0-rc.5 C3: flow-style inline YAML array, same parser as `tags`.
        out.relevance_paths = parseFlowArray(value);
        break;
      case "semantic_scope":
        // v2.2 project-scope migration: open coordinate string (schemas/scope.ts).
        // No allow-list — the grammar is open (team/personal/project:x/org:y...);
        // the modify input schema already validated it against SCOPE_COORDINATE_PATTERN.
        out.semantic_scope = stripQuotes(value);
        break;
      case "status":
        // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): strict allow-list. Unknown
        // values leave the field absent so list/search apply the "active"
        // default — matches the relevance_scope handling pattern above.
        if (value === "active" || value === "rejected" || value === "deferred") {
          out.status = value;
        }
        break;
      case "deferred_until":
        // ISO-8601 string per FabReviewInput.defer schema. We do NOT validate
        // here — list/search compare lexicographically against new Date()
        // ISO, and malformed values lose that comparison (treated as past).
        out.deferred_until = stripQuotes(value);
        break;
      case "last_review_confirmed_at":
        // v2.2 C1: ISO-8601 review-confirmation stamp (approve/modify). Parsed
        // for round-trip read; the doctor recheck lint reads it from raw body.
        out.last_review_confirmed_at = stripQuotes(value);
        break;
      case "deprecated":
        // retire (W3-C): strict boolean allow-list — only literal true/false are
        // recognized (mirrors the relevance_scope/status allow-list pattern).
        // Absent or unknown → field stays undefined → entry treated as live.
        if (value === "true" || value === "false") {
          out.deprecated = value === "true";
        }
        break;
      case "superseded_by":
        // retire (W3-C): stable_id of the replacing entry (bare or store-qualified).
        out.superseded_by = stripQuotes(value);
        break;
      default:
        break;
    }
  }

  return out;
}

function stripQuotes(value: string): string {
  return value.replace(/^["'](.*)["']$/u, "$1");
}

function parseFlowArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }
  return inner
    .split(",")
    .map((item) => stripQuotes(item.trim()))
    .filter((item) => item.length > 0);
}

/**
 * Inject `id: <stableId>` into frontmatter and remove `x-fabric-idempotency-key`
 * (which becomes meaningless after promote — the canonical file is the source
 * of truth, not the pending triple).
 *
 * Surgical edit on the frontmatter block: split on `---\n`, mutate, rejoin.
 * Preserves all other fields verbatim, including line ordering.
 */
export function rewriteFrontmatterForPromote(content: string, stableId: string): string {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (match === null) {
    // No frontmatter — synthesize one. Should not happen for real pending
    // files (extract-knowledge always writes one) but keep the function total.
    return `---\nid: ${stableId}\n---\n\n${content}`;
  }

  const block = match[1] ?? "";
  const filteredLines = block
    .split(/\r?\n/u)
    .filter((line) => !/^x-fabric-idempotency-key\s*:/u.test(line));

  // Insert `id:` as the first frontmatter line so it's prominent on read.
  filteredLines.unshift(`id: ${stableId}`);

  const newBlock = filteredLines.join("\n");
  const before = content.slice(0, match.index);
  const after = content.slice(match.index + match[0].length);
  return `${before}---\n${newBlock}\n---${after}`;
}

/**
 * Merge a frontmatter patch into an existing file's frontmatter block,
 * preserving body and unrelated keys. Used by modify (in-place + layer-flip).
 *
 * Behavior:
 *   - For each key in `patch`, replace the existing line if present, else
 *     append the line at the end of the frontmatter block.
 *   - If `forced` overrides are supplied (eg. layer-flip injects a new id),
 *     they take precedence.
 *   - Preserves comments, unrelated fields, and the body verbatim.
 */
export function rewriteFrontmatterMerge(
  content: string,
  patch: FrontmatterScalarPatch,
  forced?: { id?: string },
): string {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (match === null) {
    // No frontmatter: synthesize a minimal one.
    const synthLines: string[] = [];
    if (forced?.id !== undefined) synthLines.push(`id: ${forced.id}`);
    appendPatchLines(synthLines, patch);
    return `---\n${synthLines.join("\n")}\n---\n\n${content}`;
  }

  const block = match[1] ?? "";
  const updates: Record<string, string> = {};
  if (forced?.id !== undefined) updates.id = `id: ${forced.id}`;
  if (patch.title !== undefined) updates.title = `title: ${quoteIfNeeded(patch.title)}`;
  if (patch.summary !== undefined) updates.summary = `summary: ${quoteIfNeeded(patch.summary)}`;
  if (patch.layer !== undefined) updates.layer = `layer: ${patch.layer}`;
  if (patch.maturity !== undefined) updates.maturity = `maturity: ${patch.maturity}`;
  if (patch.tags !== undefined) updates.tags = `tags: ${flowArray(patch.tags)}`;
  // v2.0-rc.5 C3 (TASK-012): relevance hints — same flow-array shape as tags.
  if (patch.relevance_scope !== undefined) updates.relevance_scope = `relevance_scope: ${patch.relevance_scope}`;
  if (patch.relevance_paths !== undefined) updates.relevance_paths = `relevance_paths: ${flowArray(patch.relevance_paths)}`;
  // v2.2 project-scope migration: in-place re-scope (team → project:<id>).
  if (patch.semantic_scope !== undefined) updates.semantic_scope = `semantic_scope: ${patch.semantic_scope}`;
  // v2.2 graph edges: `related` flow-array, same emit shape as tags/relevance_paths.
  if (patch.related !== undefined) updates.related = `related: ${flowArray(patch.related)}`;
  // rc.9: discovery-signal scalar patches — must_read_if quoted scalar (mirror
  // summary); intent_clues + impact flow-arrays (mirror related/tags).
  if (patch.must_read_if !== undefined) updates.must_read_if = `must_read_if: ${quoteIfNeeded(patch.must_read_if)}`;
  if (patch.intent_clues !== undefined) updates.intent_clues = `intent_clues: ${flowArray(patch.intent_clues)}`;
  if (patch.impact !== undefined) updates.impact = `impact: ${flowArray(patch.impact)}`;
  // ISS-20260711-180
  if (patch.tech_stack !== undefined) updates.tech_stack = `tech_stack: ${flowArray(patch.tech_stack)}`;
  if (patch.evidence_paths !== undefined) updates.evidence_paths = `evidence_paths: ${flowArray(patch.evidence_paths)}`;
  if (patch.onboard_slot !== undefined) updates.onboard_slot = `onboard_slot: ${patch.onboard_slot}`;
  // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): status + deferred_until are only ever
  // written by reject/defer write paths. quoteIfNeeded handles ISO-8601
  // datetimes correctly (no colon in the date portion would need quoting,
  // but the `T` and `Z` separators are unambiguous YAML bareword chars).
  if (patch.status !== undefined) updates.status = `status: ${patch.status}`;
  if (patch.deferred_until !== undefined) updates.deferred_until = `deferred_until: ${quoteIfNeeded(patch.deferred_until)}`;
  // v2.2 C1: review-confirmation stamp (approve/modify).
  if (patch.last_review_confirmed_at !== undefined) updates.last_review_confirmed_at = `last_review_confirmed_at: ${quoteIfNeeded(patch.last_review_confirmed_at)}`;
  // retire (W3-C): deprecation markers. `deprecated` is a bare YAML boolean;
  // `superseded_by` is a stable_id (may be store-qualified `alias:id`, so the
  // colon forces quoteIfNeeded to quote it).
  if (patch.deprecated !== undefined) updates.deprecated = `deprecated: ${patch.deprecated}`;
  if (patch.superseded_by !== undefined) updates.superseded_by = `superseded_by: ${quoteIfNeeded(patch.superseded_by)}`;

  const lines = block.split(/\r?\n/u);
  const seen = new Set<string>();
  const newLines: string[] = [];

  for (const line of lines) {
    const sep = line.indexOf(":");
    const key = sep === -1 ? "" : line.slice(0, sep).trim();
    if (key in updates) {
      newLines.push(updates[key]!);
      seen.add(key);
    } else {
      newLines.push(line);
    }
  }

  // Append any patched keys that weren't present.
  for (const key of Object.keys(updates)) {
    if (!seen.has(key)) {
      newLines.push(updates[key]!);
    }
  }

  const newBlock = newLines.join("\n");
  const before = content.slice(0, match.index);
  const after = content.slice(match.index + match[0].length);
  return `${before}---\n${newBlock}\n---${after}`;
}

export function appendPatchLines(lines: string[], patch: FrontmatterScalarPatch): void {
  if (patch.title !== undefined) lines.push(`title: ${quoteIfNeeded(patch.title)}`);
  if (patch.summary !== undefined) lines.push(`summary: ${quoteIfNeeded(patch.summary)}`);
  if (patch.layer !== undefined) lines.push(`layer: ${patch.layer}`);
  if (patch.maturity !== undefined) lines.push(`maturity: ${patch.maturity}`);
  if (patch.tags !== undefined) lines.push(`tags: ${flowArray(patch.tags)}`);
  if (patch.relevance_scope !== undefined) lines.push(`relevance_scope: ${patch.relevance_scope}`);
  if (patch.relevance_paths !== undefined) lines.push(`relevance_paths: ${flowArray(patch.relevance_paths)}`);
  if (patch.related !== undefined) lines.push(`related: ${flowArray(patch.related)}`);
  if (patch.must_read_if !== undefined) lines.push(`must_read_if: ${quoteIfNeeded(patch.must_read_if)}`);
  if (patch.intent_clues !== undefined) lines.push(`intent_clues: ${flowArray(patch.intent_clues)}`);
  if (patch.impact !== undefined) lines.push(`impact: ${flowArray(patch.impact)}`);
  if (patch.tech_stack !== undefined) lines.push(`tech_stack: ${flowArray(patch.tech_stack)}`);
  if (patch.evidence_paths !== undefined) lines.push(`evidence_paths: ${flowArray(patch.evidence_paths)}`);
  if (patch.onboard_slot !== undefined) lines.push(`onboard_slot: ${patch.onboard_slot}`);
  if (patch.status !== undefined) lines.push(`status: ${patch.status}`);
  if (patch.deferred_until !== undefined) lines.push(`deferred_until: ${quoteIfNeeded(patch.deferred_until)}`);
  if (patch.last_review_confirmed_at !== undefined) lines.push(`last_review_confirmed_at: ${quoteIfNeeded(patch.last_review_confirmed_at)}`);
  // retire (W3-C): deprecation markers (see rewriteFrontmatterMerge for shape).
  if (patch.deprecated !== undefined) lines.push(`deprecated: ${patch.deprecated}`);
  if (patch.superseded_by !== undefined) lines.push(`superseded_by: ${quoteIfNeeded(patch.superseded_by)}`);
}

// F55 (ISS-20260531-055): flow-array emit must escape EACH element, not
// raw-join them. An element carrying a newline, `]`/`[`, `,`, quote, `#` or `:`
// would otherwise break out of the single-line `[...]` scalar and inject a new
// frontmatter key/line. Such elements are emitted as JSON double-quoted scalars
// (valid YAML, escapes `\`, `"`, newline). Diff-friendly barewords and globs
// (`auth`, `src/ui/**/*`) carry none of those chars and stay bare.
function flowArrayElement(value: string): string {
  if (/[\n\r,\[\]{}"#:]/u.test(value) || /^\s|\s$/u.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
function flowArray(values: string[]): string {
  return `[${values.map(flowArrayElement).join(", ")}]`;
}

function quoteIfNeeded(value: string): string {
  // rc.4 TASK-006 fix (a): multiline-safe emit. Newlines or carriage returns
  // would split a YAML scalar across lines and break the `---` frontmatter
  // block. Detect them BEFORE the bare-vs-quoted decision and emit a
  // JSON-escaped quoted form (\\n, \\r preserved as backslash-letter literals
  // inside double quotes, which is valid YAML 1.2 double-quoted scalar
  // syntax). Round-trip through stripQuotes is lossless because consumers
  // read the literal value (downstream parsers like knowledge-meta-builder.ts
  // strip surrounding quotes only — they don't unescape \\n; this is
  // acceptable since the rc.3 contract restricts title/summary to
  // single-line at the schema layer).
  if (/[\n\r]/u.test(value)) {
    return JSON.stringify(value);
  }
  // Quote values that contain colons, leading/trailing whitespace, or special
  // YAML chars. Otherwise emit bare so the file stays diff-friendly.
  // F36/F35 (ISS-20260531-034/033): a backslash is itself the escape char in a
  // YAML double-quoted scalar, so it MUST be doubled BEFORE escaping the inner
  // quotes — otherwise a value ending in `\` produces `"…\"`, where the trailing
  // `\"` reads as an escaped quote, swallowing the closing quote and corrupting
  // (or injecting into) the frontmatter block.
  if (/[\\:#\[\]{}&*!|>'"%@`,]|^\s|\s$/u.test(value)) {
    return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// home-dir resolver (FABRIC_HOME override mirrors knowledge-meta-builder.ts:319)
// ---------------------------------------------------------------------------

