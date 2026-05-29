import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — machine uid derivation (S33).
//
// Default uid = normalized sha256 of `git config user.email` (first 12 hex),
// prefixed `u-`. Falls back to `u-anon` when git has no configured email. The
// uid namespaces personal knowledge ids across machines/accounts (S27).
// ---------------------------------------------------------------------------
export function deriveUid(): string {
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
  const hash = createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 12);
  return `u-${hash}`;
}
