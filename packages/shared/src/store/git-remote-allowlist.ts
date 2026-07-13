/**
 * ISS-20260713-005: protocol allowlist for git remotes used by
 * `fabric install --global <url>` / store create --remote / git remote add.
 *
 * `git clone -- <url>` only blocks option injection; `ext::`, `file://`, and
 * other helpers remain executable as a repository argument. Reject anything
 * outside https / http / ssh / scp-like git@host:path / git:// before spawn.
 */

const ALLOWED_REMOTE_RE =
  /^(?:https?:\/\/|ssh:\/\/|git:\/\/|git@[^:\s]+:)/i;

const BLOCKED_REMOTE_RE =
  /^(?:ext::|file:\/\/|fd::|http\+\w+:\/\/|https\+\w+:\/\/)/i;

export function isAllowedGitRemote(remote: string): boolean {
  const trimmed = remote.trim();
  if (trimmed.length === 0) return false;
  if (BLOCKED_REMOTE_RE.test(trimmed)) return false;
  // Reject leading dashes even after allowlist (defense in depth; clone also uses --).
  if (trimmed.startsWith("-")) return false;
  return ALLOWED_REMOTE_RE.test(trimmed);
}

export function assertAllowedGitRemote(remote: string): string {
  const trimmed = remote.trim();
  if (!isAllowedGitRemote(trimmed)) {
    throw new Error(
      `git remote not allowlisted: ${remote} (allowed: https://, http://, ssh://, git://, git@host:path; blocked: ext::, file://, option-like)`,
    );
  }
  return trimmed;
}
