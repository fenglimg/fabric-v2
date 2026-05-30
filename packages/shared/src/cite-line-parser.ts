// v2.0.0-rc.24 TASK-03: shared cite-line parser. Zero-dep; hooks inline-bundle
// this module (no node_modules at hook runtime), so non-type imports are
// forbidden. Mirrors `## Cite policy` syntax in bootstrap-canonical.ts and
// emits shapes index-aligned with assistant_turn_observed in event-ledger.ts.
//
// Index contract: cite_commitments[i] ↔ cite_ids[i]. Sentinel `KB: none`
// emits a "none" cite_tag only — no id, no commitment (bracket reason is
// retained in kb_line_raw upstream per rc.23 T8). Unknown contract tokens
// are silently dropped for rc.25+ forward-compat.
//
// v2.1.0-rc.1 (ADJ-P4-1, full remap): the rc.37 NEW-1 2-state vocabulary
// (`applied` / `dismissed`) is now the ONLY emitted tag set. Legacy rc≤36 tags
// (planned / recalled / chained-from) all expressed "I applied this KB" and are
// remapped to `applied` at parse time — not accepted verbatim. The same remap
// (`normalizeCiteTag`) is reused by event-ledger.ts cite_tags preprocess so
// on-disk legacy events normalize to the 2-state vocab on read. Full remap, not
// dual-vocabulary coexistence: downstream consumers only ever see
// applied/dismissed/none.

export type CiteTag = "applied" | "dismissed" | "none";

export type CiteCommitmentOperatorKind =
  | "edit"
  | "not_edit"
  | "require"
  | "forbid";

export interface CiteCommitmentOperator {
  kind: CiteCommitmentOperatorKind;
  target: string;
}

export interface CiteCommitment {
  operators: CiteCommitmentOperator[];
  skip_reason: string | null;
}

export interface ParseCiteLineResult {
  cite_ids: string[];
  cite_tags: CiteTag[];
  cite_commitments: CiteCommitment[];
  // v2.1.0-rc.1 P4 (F3/S62): store qualifier per cite_id, index-aligned with
  // cite_ids. `<alias-or-uuid>:<id>` → the qualifier; a bare id → null. The
  // qualifier disambiguates a shadowed local id across the read-set (S61).
  cite_stores: (string | null)[];
}

const ID_RE = /^K[TP]-[A-Z]+-\d+$/;
const SENTINEL_RE = /^KB:\s*none\b\s*(?:\[[^\]]*\])?\s*$/i;
// `KB: [<store>:]<ID>[, [<store>:]<ID>...] [(anchor)] [[tag]] [→ <contract>]` —
// store qualifier / anchor / tag / contract are individually optional. Contract
// tail starts at the first `→`.
//
// v2.0.0-rc.27 TASK-003 (audit §2.18): the ID group now accepts comma-separated
// multi-id citations (e.g. `KB: KT-DEC-0001, KT-PIT-0005 (combined)`). The
// shared AGENTS.md cite-policy promised this since rc.5 but rc.26 emitted
// `cite_ids: []` for any comma input — parser-doc gap. ID_RE still validates
// each individual id at extract time so malformed entries still drop cleanly.
//
// v2.1.0-rc.1 P4 (F3/S62): each id may carry an optional `<store>:` prefix
// (`team:KT-DEC-0001`). The store qualifier (`[^\s,:]+`) is everything before
// the local id's final `:`; it is stripped + surfaced into cite_stores.
const QUALIFIED_ID = String.raw`(?:[^\s,:]+:)?K[TP]-[A-Z]+-\d+`;
const FULL_RE = new RegExp(
  String.raw`^KB:\s+(${QUALIFIED_ID}(?:\s*,\s*${QUALIFIED_ID})*)(?:\s+\(([^)]*)\))?(?:\s+\[([^\]]+)\])?(?:\s+→\s*(.+))?\s*$`,
);

// Split `<store>:<id>` into its qualifier + local id; a bare id yields a null
// qualifier. The local id is the `K[PT]-...` tail (never contains a colon), so
// the final colon separates the (optional) store qualifier from the id.
function splitStorePrefix(token: string): { store: string | null; id: string } {
  const colon = token.lastIndexOf(":");
  return colon === -1
    ? { store: null, id: token }
    : { store: token.slice(0, colon), id: token.slice(colon + 1) };
}
// Extracts the embedded id from a `[chained-from <ID>]` tag tail. The audit
// (§2.18) called out that rc.26's parser recognised the tag name but
// silently dropped the chained id. We now expose it as a sibling cite_id so
// downstream cite-coverage routing can connect the chain.
const CHAINED_FROM_ID_RE = /chained-from\s+(K[TP]-[A-Z]+-\d+)/i;

// v2.1.0-rc.1 (ADJ-P4-1, full remap): legacy rc≤36 tags collapse to `applied`.
// Single source of truth — reused by event-ledger.ts cite_tags preprocess so a
// stored head (e.g. "recalled") and a raw tag with a tail (e.g.
// "chained-from KT-DEC-0009") both normalize identically.
const LEGACY_CITE_TAG_REMAP: Readonly<Record<string, CiteTag>> = {
  planned: "applied",
  recalled: "applied",
  "chained-from": "applied",
};

/**
 * Normalize a raw cite tag (with optional tail) into the 2-state vocabulary.
 * `applied` / `dismissed` / `none` pass through; the three legacy tags remap to
 * `applied`; anything else degrades to `none` (forward/back-compat tolerance).
 */
export function normalizeCiteTag(rawTag: string): CiteTag {
  // Tags may carry tails like `chained-from KT-DEC-0001` or
  // `dismissed:scope-mismatch`; head token (whitespace/colon-bounded) wins.
  const head = rawTag.trim().split(/[\s:]+/)[0].toLowerCase();
  if (head === "applied" || head === "dismissed" || head === "none") {
    return head;
  }
  return LEGACY_CITE_TAG_REMAP[head] ?? "none";
}

function parseTag(rawTag: string | undefined): CiteTag {
  if (!rawTag) return "none";
  return normalizeCiteTag(rawTag);
}

function parseContractTail(tail: string | undefined): CiteCommitment {
  const result: CiteCommitment = { operators: [], skip_reason: null };
  if (!tail) return result;
  const tokens = tail.trim().split(/\s+/).filter((t) => t.length > 0);
  for (const token of tokens) {
    // skip:<reason> — reason may itself contain a colon (skip:other:<text>).
    const skipMatch = token.match(/^skip:(.+)$/i);
    if (skipMatch) {
      if (result.skip_reason === null) result.skip_reason = skipMatch[1];
      continue;
    }
    // !edit:<target> → schema kind "not_edit".
    const notEditMatch = token.match(/^!edit:(.+)$/i);
    if (notEditMatch) {
      result.operators.push({ kind: "not_edit", target: notEditMatch[1] });
      continue;
    }
    const opMatch = token.match(/^(edit|require|forbid):(.+)$/i);
    if (opMatch) {
      result.operators.push({
        kind: opMatch[1].toLowerCase() as CiteCommitmentOperatorKind,
        target: opMatch[2],
      });
    }
    // Unknown token → forward-compat drop.
  }
  return result;
}

function parseLine(line: string): {
  // v2.0.0-rc.27 TASK-003 (audit §2.18): id field renamed semantically — it
  // now carries an array of one-or-more validated ids parsed from the
  // primary citation group, PLUS any tag-embedded chained-from id appended
  // at the end. Sentinel lines return an empty array.
  ids: string[];
  stores: (string | null)[];
  tag: CiteTag;
  commitment: CiteCommitment | null;
} | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (SENTINEL_RE.test(trimmed)) {
    return { ids: [], stores: [], tag: "none", commitment: null };
  }
  const fullMatch = trimmed.match(FULL_RE);
  if (fullMatch) {
    // v2.0.0-rc.27 TASK-003 (audit §2.18): split the primary id group on
    // commas (FULL_RE already validated the joint shape). Each candidate is
    // re-validated against ID_RE so a malformed entry inside an otherwise
    // well-formed multi-id line drops cleanly instead of partial-emitting.
    // v2.1.0-rc.1 P4 (F3): each candidate may carry a `<store>:` prefix; strip
    // + surface it alongside the validated local id.
    const split = fullMatch[1]
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map(splitStorePrefix);
    if (split.some((entry) => !ID_RE.test(entry.id))) return null;
    const primaryIds = split.map((entry) => entry.id);
    const primaryStores = split.map((entry) => entry.store);

    const rawTag = fullMatch[3];
    const tag = parseTag(rawTag);

    // Tag tail may carry an embedded id (e.g. `chained-from KT-MOD-0007`).
    // Surface it as an additional cite_id so cite-coverage routing can
    // resolve the chain link. The tag enum stays untouched.
    const chainedIds: string[] = [];
    if (rawTag !== undefined) {
      const chained = CHAINED_FROM_ID_RE.exec(rawTag);
      if (chained !== null && ID_RE.test(chained[1])) {
        chainedIds.push(chained[1]);
      }
    }

    return {
      ids: [...primaryIds, ...chainedIds],
      // chained-from ids are never store-qualified → null per chained id.
      stores: [...primaryStores, ...chainedIds.map(() => null)],
      tag,
      commitment: parseContractTail(fullMatch[4]),
    };
  }
  return null;
}

/**
 * Parse one or more newline-separated `KB:` cite lines into structured
 * arrays matching the assistant_turn_observed event-ledger fields.
 *
 * Tolerates whitespace, CR/LF line endings, blank lines, and non-KB
 * interleaved prose. Index contract documented above.
 *
 * v2.0.0-rc.27 TASK-003 (audit §2.18): multi-id citations
 * (`KB: KT-DEC-0001, KT-PIT-0005 ...`) emit each id into cite_ids in
 * declaration order. The chained-from tag's embedded id (when present)
 * appends after the primary group. cite_tags still carries one tag per
 * LINE — multi-id lines don't multiply the tag stream.
 */
export function parseCiteLine(raw: string): ParseCiteLineResult {
  const result: ParseCiteLineResult = {
    cite_ids: [],
    cite_tags: [],
    cite_commitments: [],
    cite_stores: [],
  };
  if (typeof raw !== "string") return result;
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    result.cite_tags.push(parsed.tag);
    for (let i = 0; i < parsed.ids.length; i += 1) {
      result.cite_ids.push(parsed.ids[i]);
      result.cite_stores.push(parsed.stores[i] ?? null);
    }
    if (parsed.commitment !== null) {
      // v2.0.0-rc.27.1 (Codex review fix): cite_commitments MUST be index-
      // aligned with cite_ids per the schema doc on event-ledger.ts:428.
      // Multi-id citations share ONE parsed contract — propagate it across
      // every id slot so downstream consumers (`doctor.ts` per-cite walk +
      // `cite-contract-reminder.cjs`) can look up `commitments[i]` for any
      // valid `i < cite_ids.length` without falling into an undefined slot.
      for (let i = 0; i < parsed.ids.length; i += 1) {
        result.cite_commitments.push(parsed.commitment);
      }
    }
  }
  return result;
}
