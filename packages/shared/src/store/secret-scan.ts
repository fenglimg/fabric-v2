// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P2 — Secret scan (S26-gate, write-path leak prevention).
//
// Pure content scanner feeding the archive viability gate: if an entry body
// about to be written carries a credential-shaped string, the gate BLOCKS the
// write (a secret must never land in a store git, least of all a shared one).
// Front-loaded with the write path (not deferred to P5) so archive/extract
// cannot ship a leak. Findings redact the matched value — we never echo the
// secret back.
// ---------------------------------------------------------------------------

export interface SecretFinding {
  rule: string;
  line: number; // 1-based
}

interface SecretRule {
  rule: string;
  re: RegExp;
}

const SECRET_RULES: SecretRule[] = [
  { rule: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { rule: "openai-api-key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { rule: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { rule: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    rule: "credential-assignment",
    re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  },
];

// Scan content line-by-line; returns one finding per (rule, line) hit. Ordered
// by line then rule for determinism.
export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    for (const { rule, re } of SECRET_RULES) {
      if (re.test(lines[i])) {
        findings.push({ rule, line: i + 1 });
      }
    }
  }
  return findings;
}

// Convenience for the viability gate: true when any secret pattern matched.
export function hasSecrets(content: string): boolean {
  return scanForSecrets(content).length > 0;
}

// v2.1.0-rc.1 P6 (S40): replace every secret-shaped match with a redaction
// placeholder so diagnostics (e.g. `doctor --debug-bundle`) can include content
// without leaking credentials. The matched span is swapped for
// `[REDACTED:<rule>]`; non-secret text is untouched. Idempotent on clean input.
export const REDACTION_PLACEHOLDER_PREFIX = "[REDACTED:";

export function redactSecrets(content: string): string {
  let out = content;
  for (const { rule, re } of SECRET_RULES) {
    // Global, case-insensitive variant of each rule so every occurrence on
    // every line is replaced (the scan rules are single-match by design).
    const flags = re.flags.includes("i") ? "gi" : "g";
    out = out.replace(new RegExp(re.source, flags), `${REDACTION_PLACEHOLDER_PREFIX}${rule}]`);
  }
  return out;
}

// ISS-044: strip credential userinfo (`user:secret@`) from a git remote URL
// before it is persisted into a registry (global config mounted store, project
// `suggested_remote`). Auth belongs in `.git/config` (gitignored by git) or a
// credential helper — NEVER in a shared/tracked registry entry. Only the
// password/token form (userinfo containing ':') is stripped; bare-user SSH
// (`ssh://git@host`) and scp-like (`git@github.com:org/repo`) syntax are
// credential-free and left untouched. Non-URL / non-string input passes through.
export function scrubRemoteUrl(remote: string): string {
  return remote.replace(
    /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@]*:[^/@]*@/,
    "$1",
  );
}
