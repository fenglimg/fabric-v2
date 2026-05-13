# Fabric configuration reference

This document is the canonical reference for Fabric's user-facing
configuration surfaces. Each section enumerates the available knobs, their
defaults, and recommended values for small / medium / large repos.

> Status: this file is being built out across rc.7. The `--apply-lint
> safety` section was added by T11; the hook-threshold + fabric-config.json
> reference is added by T07.

## `--apply-lint` safety (rc.7 T11)

`fabric doctor --apply-lint` mutates user-knowledge state: it rewrites
frontmatter (`maturity` demotions), runs `git mv` to relocate stale entries
into `.fabric/.archive/`, deletes session-hint cache files, and bumps drifted
counters in `agents.meta.json`. Because the surface is destructive, the
command refuses to mutate without an explicit confirmation.

### Behavior

When `--apply-lint` is invoked the doctor command:

1. Runs a pre-flight `runDoctorReport()` to enumerate the proposed mutations.
2. Renders a plan banner to stdout with per-code counts and a preview of up
   to twelve entries.
3. Decides whether to proceed based on the rules below.

### Bypass options

| Mechanism                          | Effect                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `--yes` flag                       | Skip the confirm prompt. Required for non-tty CI invocations.                   |
| `FABRIC_NONINTERACTIVE=1` env var  | Skip the confirm prompt. Useful for nested process invocations.                 |
| Interactive tty, user answers `y`  | Confirm prompt appears with default `N`; user must explicitly type `y`.         |
| Interactive tty, user answers `n`  | Exit code `1`. No mutations occur.                                              |
| Non-tty stdin AND no bypass        | Exit code `1`. Error written to stderr explaining the requirement.              |

The pair `--yes` + `FABRIC_NONINTERACTIVE` is intentional and orthogonal:

- `--yes` is the explicit-CLI knob (`fabric doctor --apply-lint --yes`).
- `FABRIC_NONINTERACTIVE=1` is the environment knob (POSIX-style, mirrors
  `DEBIAN_FRONTEND=noninteractive`). It is useful when Fabric is invoked
  from a wrapping pipeline that does not have direct control over the
  argv passed to doctor.

### Recommended usage

- **Local development (interactive)**: just run
  `fabric doctor --apply-lint`. Read the plan, confirm if it looks right.
- **CI (workflow steps)**: use `--yes` explicitly. Example:
  `fabric doctor --apply-lint --yes`. Prefer this over the env var because
  the intent is visible in the workflow file.
- **Wrapped invocations (e.g. nested doctor calls in a build pipeline)**:
  set `FABRIC_NONINTERACTIVE=1` once at the top of the pipeline and let
  every Fabric invocation inherit it.

### Plan no-op shortcut

When the pre-flight report shows zero apply-lint findings the plan banner
and the confirm prompt are both skipped. `runDoctorApplyLint()` still runs
so the standard no-op message ("No apply-lint mutations were needed.") is
emitted.
