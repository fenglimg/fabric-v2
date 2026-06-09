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
  category: "credential" | "pii";
}

const CREDENTIAL_RULES: SecretRule[] = [
  { rule: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/, category: "credential" },
  { rule: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, category: "credential" },
  { rule: "openai-api-key", re: /\bsk-[A-Za-z0-9]{20,}\b/, category: "credential" },
  { rule: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, category: "credential" },
  { rule: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, category: "credential" },
  {
    rule: "credential-assignment",
    re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|token)\s*[:=]\s*(?:"[^'"\s]{8,}"|'[^'"\s]{8,}'|[A-Za-z0-9_./+=:@-]{8,})/i,
    category: "credential",
  },
];

const PII_RULES: SecretRule[] = [
  {
    rule: "email-address",
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    category: "pii",
  },
  {
    rule: "ipv4-address",
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/,
    category: "pii",
  },
  {
    rule: "phone-number",
    re: /(?<!\d)(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)/,
    category: "pii",
  },
];

const SECRET_RULES: SecretRule[] = [...CREDENTIAL_RULES, ...PII_RULES];

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

// Convenience for the viability gate: true when a credential pattern matched.
// PII is redacted before persistence instead of blocking otherwise valid KB.
export function hasSecrets(content: string): boolean {
  const lines = content.split(/\r?\n/u);
  for (const line of lines) {
    for (const { re } of CREDENTIAL_RULES) {
      if (re.test(line)) {
        return true;
      }
    }
  }
  return false;
}

// v2.1.0-rc.1 P6 (S40): replace every secret-shaped match with a redaction
// placeholder so diagnostics (e.g. `doctor --debug-bundle`) can include content
// without leaking credentials. The matched span is swapped for
// `[REDACTED:<rule>]`; non-secret text is untouched. Idempotent on clean input.
export const REDACTION_PLACEHOLDER_PREFIX = "[REDACTED:";

export function redactSecrets(content: string): string {
  return redactByRules(content, SECRET_RULES);
}

export function redactPii(content: string): string {
  return redactByRules(content, PII_RULES);
}

function redactByRules(content: string, rules: SecretRule[]): string {
  let out = content;
  for (const { rule, re } of rules) {
    // Global, case-insensitive variant of each rule so every occurrence on
    // every line is replaced (the scan rules are single-match by design).
    const flags = re.flags.includes("i") ? "gi" : "g";
    out = out.replace(new RegExp(re.source, flags), `${REDACTION_PLACEHOLDER_PREFIX}${rule}]`);
  }
  return out;
}

// ISS-044 / F62 (ISS-20260531-103): strip credential userinfo from a git remote
// URL before it is persisted into a registry (global config mounted store,
// project `suggested_remote`). Auth belongs in `.git/config` (gitignored by git)
// or a credential helper — NEVER in a shared/tracked registry entry.
//
// http(s) userinfo is credential-bearing: besides `user:password@`, a personal
// access token is commonly passed as a BARE username with no ':' separator
// (`https://ghp_token@github.com/org/repo.git`). The original regex required a
// ':' and therefore leaked that token verbatim. So for http(s) we strip the
// ENTIRE userinfo segment (with or without ':').
//
// For other schemes a bare `user@` is the conventional, credential-free account
// selector — `ssh://git@host` and scp-like `git@github.com:org/repo` must stay
// intact — so only the password form (userinfo containing ':') is stripped.
// Non-URL / non-string input passes through.
export function scrubRemoteUrl(remote: string): string {
  const httpStripped = remote.replace(/^(https?:\/\/)[^/@]+@/i, "$1");
  if (httpStripped !== remote) {
    return httpStripped;
  }
  return remote.replace(
    /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@]*:[^/@]*@/,
    "$1",
  );
}
