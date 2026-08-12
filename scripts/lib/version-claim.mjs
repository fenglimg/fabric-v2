/**
 * The README version-claim shape — shared by the two scripts that must agree on
 * it: the gate that DETECTS drift (scripts/doc-drift-gate.mjs) and the bump that
 * PREVENTS it (scripts/apply-tag-version.mjs).
 *
 * They are a producer/consumer pair. If each kept its own regex, a widening on
 * one side (say, accepting a blockquote-prefixed claim) would silently stop
 * matching on the other: the bump would leave a line the gate still checks, and
 * every release would go red again — the very failure this module removes by
 * construction. One regex, two importers.
 */

/**
 * A line-LEADING bold version, optionally preceded by list/quote markers.
 *
 * Line-leading is the whole point: prose that RECOUNTS history ("isolated in
 * v2.0.0-rc.37") is not a claim about the present, so an inline version is
 * expected to differ from the current one and must not be matched — neither to
 * fail the gate nor to be rewritten by the bump.
 *
 * (History: this was anchored at column 0 and knew only `-rc.N`, so turning the
 * line into a list item, or moving to a `-beta.N` prerelease, silently removed
 * the only claim the gate exists to check. Now: optional markers, any
 * prerelease tag.)
 */
export const BOLD_VERSION_RE = /^(?:[-*>]\s+)*\*\*v(\d+\.\d+\.\d+(?:-[0-9a-z.]+)?)\*\*/u;

/**
 * Rewrite every line-leading version claim in `source` to `version`.
 *
 * Only the `**vX.Y.Z**` token is replaced — leading list/quote markers and the
 * trailing prose on the line are preserved byte-for-byte, so this stays safe to
 * run over a hand-written README.
 *
 * Returns `{ content, claims }` where `claims` describes every claim found
 * (including ones that already matched, reported as `changed: false`).
 *
 * Throws when the document carries NO version claim. That is the same
 * fail-on-empty-parse discipline the gate applies on the assertion side
 * (`no_version_claim`): a bump that silently rewrote nothing is
 * indistinguishable from one that worked, and would let drift straight back in
 * the moment someone rewords the line.
 */
export function rewriteVersionClaims(source, version, label = "<source>") {
  const lines = source.split("\n");
  const claims = [];

  const rewritten = lines.map((line, index) => {
    const match = BOLD_VERSION_RE.exec(line);
    if (match === null) {
      return line;
    }

    const previous = match[1];
    claims.push({ line: index + 1, previous, next: version, changed: previous !== version });

    if (previous === version) {
      return line;
    }

    // match[0] is anchored at index 0 and ends with the bold token, so swapping
    // its tail rewrites the version without touching markers or trailing prose.
    const head = match[0];
    const token = `**v${previous}**`;
    const newHead = `${head.slice(0, head.length - token.length)}**v${version}**`;
    return newHead + line.slice(head.length);
  });

  if (claims.length === 0) {
    throw new Error(
      `${label}: contains no line-leading **vX.Y.Z** version claim, so the version bump would be a silent no-op. ` +
        `Did the claim get reworded or moved? (doc-drift-gate reports this same condition as no_version_claim.)`,
    );
  }

  return { content: rewritten.join("\n"), claims };
}
