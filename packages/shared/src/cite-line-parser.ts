// v2.0.0-rc.24 TASK-03: shared cite-line parser. Zero-dep; hooks inline-bundle
// this module (no node_modules at hook runtime), so non-type imports are
// forbidden. Mirrors `## Cite policy` syntax in bootstrap-canonical.ts and
// emits shapes index-aligned with assistant_turn_observed in event-ledger.ts.
//
// Index contract: cite_commitments[i] ↔ cite_ids[i]. Sentinel `KB: none`
// emits a "none" cite_tag only — no id, no commitment (bracket reason is
// retained in kb_line_raw upstream per rc.23 T8). Unknown contract tokens
// are silently dropped for rc.25+ forward-compat.

export type CiteTag =
  | "planned"
  | "recalled"
  | "chained-from"
  | "dismissed"
  | "none";

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
}

const ID_RE = /^K[TP]-[A-Z]+-\d+$/;
const SENTINEL_RE = /^KB:\s*none\b\s*(?:\[[^\]]*\])?\s*$/i;
// `KB: <ID> [(anchor)] [[tag]] [→ <contract>]` — anchor / tag / contract
// are individually optional. Contract tail starts at the first `→`.
const FULL_RE =
  /^KB:\s+(K[TP]-[A-Z]+-\d+)(?:\s+\(([^)]*)\))?(?:\s+\[([^\]]+)\])?(?:\s+→\s*(.+))?\s*$/;

const ALLOWED_TAGS: ReadonlySet<CiteTag> = new Set([
  "planned",
  "recalled",
  "chained-from",
  "dismissed",
  "none",
]);

function parseTag(rawTag: string | undefined): CiteTag {
  if (!rawTag) return "none";
  // Tags may carry tails like `chained-from KT-DEC-0001` or
  // `dismissed:scope-mismatch`; head token (whitespace/colon-bounded) wins.
  const head = rawTag.trim().split(/[\s:]+/)[0].toLowerCase();
  return (ALLOWED_TAGS as ReadonlySet<string>).has(head)
    ? (head as CiteTag)
    : "none";
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
  id: string | null;
  tag: CiteTag;
  commitment: CiteCommitment | null;
} | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (SENTINEL_RE.test(trimmed)) {
    return { id: null, tag: "none", commitment: null };
  }
  const fullMatch = trimmed.match(FULL_RE);
  if (fullMatch) {
    const id = fullMatch[1];
    if (!ID_RE.test(id)) return null;
    return {
      id,
      tag: parseTag(fullMatch[3]),
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
 */
export function parseCiteLine(raw: string): ParseCiteLineResult {
  const result: ParseCiteLineResult = {
    cite_ids: [],
    cite_tags: [],
    cite_commitments: [],
  };
  if (typeof raw !== "string") return result;
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    result.cite_tags.push(parsed.tag);
    if (parsed.id !== null) result.cite_ids.push(parsed.id);
    if (parsed.commitment !== null) {
      result.cite_commitments.push(parsed.commitment);
    }
  }
  return result;
}
