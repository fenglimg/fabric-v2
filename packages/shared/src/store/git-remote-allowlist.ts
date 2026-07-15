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

// A bare absolute filesystem path (POSIX `/…` or Windows `C:\…` / `C:/…`) with no
// URL scheme. Real `git clone` accepts these for local repos; production blocks
// them (they never match ALLOWED_REMOTE_RE), but the test runner needs them so
// clone/mount tests can seed a throwaway `git init --bare` remote on disk.
const ABSOLUTE_LOCAL_PATH_RE = /^(?:\/|[A-Za-z]:[\\/])/;

// Same VITEST seam the shared store-config path uses (isTestRuntime in
// store/global-config-io.ts): never true in a shipped CLI, so this only ever
// relaxes the allowlist under vitest.
function isTestRuntime(): boolean {
  return process.env.VITEST !== undefined || process.env.VITEST_WORKER_ID !== undefined;
}

export function isAllowedGitRemote(remote: string): boolean {
  const trimmed = remote.trim();
  if (trimmed.length === 0) return false;
  if (BLOCKED_REMOTE_RE.test(trimmed)) return false;
  // Reject leading dashes even after allowlist (defense in depth; clone also uses --).
  if (trimmed.startsWith("-")) return false;
  if (ALLOWED_REMOTE_RE.test(trimmed)) return true;
  // Test-only: allow a bare absolute local path (a `git init --bare` fixture) so
  // clone+mount tests exercise real git. The file:// / ext:: / option-like blocks
  // above still apply, so their rejection tests stay green even under vitest.
  return isTestRuntime() && ABSOLUTE_LOCAL_PATH_RE.test(trimmed);
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
