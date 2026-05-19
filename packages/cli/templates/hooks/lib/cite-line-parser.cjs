// v2.0.0-rc.24 TASK-04: CJS twin of packages/shared/src/cite-line-parser.ts.
//
// Hook runtime has NO node_modules access, so the shared TS module cannot be
// imported. This file is a hand-authored CJS mirror; behavioral parity is
// asserted by packages/cli/__tests__/cite-line-parser-parity.test.ts which
// runs both implementations against the same corpus and asserts identical
// output. Any drift between this file and ../../shared/src/cite-line-parser.ts
// MUST be reflected in BOTH files plus the parity-test corpus, otherwise the
// parity test fails and blocks the commit.
//
// Why a hand-authored twin (not transpile-at-install or string-template inject)?
//   - tsup/esbuild are CLI build-time deps, NOT install-time deps; bundling
//     them into the install pipeline grows the user-facing footprint.
//   - The parser is small (≤150 LOC), pure (zero deps), and rarely changes —
//     hand-syncing is cheaper than introducing transpile machinery.
//   - The existing `installHookLibs` pipeline auto-copies every `.cjs` under
//     templates/hooks/lib/ to each client's hooks/lib/ dir, so this file
//     auto-ships to cc/codex/cursor with no install pipeline change.
//
// Vocabulary contract (mirrored 1:1 with the TS source):
//   - cite_tags enum: planned | recalled | chained-from | dismissed | none
//   - operator kinds: edit | not_edit | require | forbid
//     (source token `!edit:` → schema kind `not_edit`)
//   - skip:<reason> captures everything after the first colon, so
//     `skip:other:non-codifiable` yields skip_reason="other:non-codifiable".
//   - Index contract: cite_commitments[i] ↔ cite_ids[i]. Sentinel `KB: none`
//     contributes a "none" cite_tag only — no id, no commitment.

const ID_RE = /^K[TP]-[A-Z]+-\d+$/;
const SENTINEL_RE = /^KB:\s*none\b\s*(?:\[[^\]]*\])?\s*$/i;
const FULL_RE =
  /^KB:\s+(K[TP]-[A-Z]+-\d+)(?:\s+\(([^)]*)\))?(?:\s+\[([^\]]+)\])?(?:\s+→\s*(.+))?\s*$/;

const ALLOWED_TAGS = new Set([
  "planned",
  "recalled",
  "chained-from",
  "dismissed",
  "none",
]);

function parseTag(rawTag) {
  if (!rawTag) return "none";
  // Tags may carry tails like `chained-from KT-DEC-0001` or
  // `dismissed:scope-mismatch`; head token (whitespace/colon-bounded) wins.
  const head = rawTag.trim().split(/[\s:]+/)[0].toLowerCase();
  return ALLOWED_TAGS.has(head) ? head : "none";
}

function parseContractTail(tail) {
  const result = { operators: [], skip_reason: null };
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
        kind: opMatch[1].toLowerCase(),
        target: opMatch[2],
      });
    }
    // Unknown token → forward-compat drop.
  }
  return result;
}

function parseLine(line) {
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
 * Parse one or more newline-separated `KB:` cite lines into structured arrays
 * matching the assistant_turn_observed event-ledger fields. Tolerates
 * whitespace, CR/LF, blank lines, interleaved prose. Never throws.
 */
function parseCiteLine(raw) {
  const result = { cite_ids: [], cite_tags: [], cite_commitments: [] };
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

module.exports = { parseCiteLine };
