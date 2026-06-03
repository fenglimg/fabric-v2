/**
 * F27: surface unrecognized `--flags` instead of silently swallowing them.
 *
 * citty (0.2.2, mri-based) parses unknown flags into the args object but never
 * rejects them, so `fabric whoami --jsno` exits 0 with plain text and zero
 * signal that the typo was ignored. This scans the raw argv for long flags not
 * in the command's known set and writes ONE non-blocking stderr warning. It is a
 * NUDGE, not a gate (KT-DEC-0007): the command still runs to completion.
 *
 * Scoped to the read-only info commands (whoami / status) that declared no args
 * before F27 — deliberately NOT a global citty strict-mode flip, which would
 * risk rejecting flags other commands already accept.
 */
export function warnUnknownFlags(known: readonly string[]): void {
  const knownSet = new Set<string>([...known, "help", "version"]);
  const unknown: string[] = [];
  for (const tok of process.argv.slice(2)) {
    if (!tok.startsWith("--")) continue;
    // strip `=value` and citty's `--no-<flag>` boolean-negation prefix
    const name = tok.slice(2).split("=")[0].replace(/^no-/, "");
    if (name.length === 0) continue;
    if (!knownSet.has(name)) unknown.push(tok.split("=")[0]);
  }
  if (unknown.length > 0) {
    process.stderr.write(`[fabric] ignored unknown flag(s): ${unknown.join(", ")}\n`);
  }
}
