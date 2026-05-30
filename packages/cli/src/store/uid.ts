import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — machine uid derivation (S33).
//
// Default uid = normalized sha256 of `git config user.email` (first 12 hex),
// prefixed `u-`. Falls back to `u-anon` when git has no configured email. The
// uid namespaces personal knowledge ids across machines/accounts (S27).
//
// W4-13 (ISS-045) — re-identification hardening + decision record:
//   The default (unsalted) uid is a stable pseudonymous identifier: anyone with
//   a candidate email list can hash it and match. We keep the UNSALTED default
//   deliberately — it is what keeps the same user's personal namespace stable
//   across their own machines (S27), and the resolver already isolates personal
//   (KP-*) stores so they never leak into another developer's shared recall.
//   The residual exposure exists ONLY if a personal store is deliberately
//   shared (an anti-pattern). For that case an optional `salt` makes the uid
//   non-re-identifiable without an attacker also knowing the per-user salt.
//   Backward compatibility is unconditional: existing installs persist `uid` in
//   the global config and never re-derive it, so adding salt never rewrites
//   already-minted KP-* ids — only a fresh install observes a new derivation.
// ---------------------------------------------------------------------------
export function deriveUid(opts: { salt?: string } = {}): string {
  let email = "";
  try {
    email = execFileSync("git", ["config", "user.email"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    email = "";
  }
  if (email === "") {
    return "u-anon";
  }
  // Salt (when supplied) is prefixed so the digest is not a bare hash of the
  // email — `<salt>:<email>` cannot be reversed by hashing a candidate email
  // list alone. Omitting salt reproduces the original sha256(email) exactly.
  const material =
    opts.salt !== undefined && opts.salt.length > 0
      ? `${opts.salt}:${email.toLowerCase()}`
      : email.toLowerCase();
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 12);
  return `u-${hash}`;
}
