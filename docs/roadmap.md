# Fabric v2.0 Roadmap

Status: v1.0 = 7-day MVP (in progress); v1.1 = Maintenance milestone (deferred)

## v1.1 Feature 1: `drift-check`

**Purpose**

Add a maintenance-oriented check for doc-code drift so Fabric can warn when implementation activity has likely outpaced AGENTS.md updates.

**Rationale for deferral**

This is explicitly deferred out of the v1.0 MVP because April 2026 research indicates there is no mainstream tool that already solves doc-code drift detection well enough to adopt directly. The feature needs a Fabric-specific heuristic, which makes it valuable but non-essential for the first 7-day release.

**Trigger for revisit**

Revisit when the v1.1 maintenance milestone starts.

**Proposed approach sketch**

Use a warning-oriented heuristic rather than a hard gate. Compare code-history activity against documentation freshness, starting with `git log --follow` on relevant code files and an AGENTS.md modification-time heuristic. If a path accumulates N code commits without a corresponding AGENTS.md update, Fabric should surface a warning for human review.

## v1.1 Feature 2: `fab migrate`

**Purpose**

Provide a migration helper for Fabric-managed metadata so projects can upgrade safely when `.fabric/` formats change over time.

**Rationale for deferral**

The current MVP only needs to establish the first working format. Schema migration becomes important once `agents.meta.json` starts evolving, especially around likely future changes such as a richer `nodes` field and revision format adjustments. Building migration machinery before the first schema exists would add maintenance overhead without immediate user value.

**Trigger for revisit**

Revisit when a breaking change to the `.fabric/` format is introduced or approved.

**Proposed approach sketch**

Adopt explicit schema versioning for Fabric metadata and pair each version bump with migration transformers. The command should detect the on-disk version, apply ordered transforms to the target version, and leave a clear audit trail of what changed.

## v1.1 Feature 3: `fab doctor`

**Purpose**

Offer a self-diagnosis command for installation and support troubleshooting across Fabric's six target AI clients.

**Rationale for deferral**

The 6-client setup is one of the hardest parts of the Fabric experience, but the MVP first needs to ship the actual server, CLI, config generation, and pre-commit flow. A diagnostic layer is valuable once real support issues appear, not before there is enough field feedback to shape the checks.

**Trigger for revisit**

Revisit when support issues related to setup, health, or client integration begin to surface.

**Proposed approach sketch**

Probe all six client configurations for a valid Fabric server entry, check local hook health for both `lefthook` and `husky`, and validate the integrity of `.fabric/agents.meta.json`. The command should focus on actionable diagnostics and remediation hints rather than automatic repair.

## v1.1 Feature 4: Copilot fallback compile

**Purpose**

Create a fallback path for GitHub Copilot users by compiling the AGENTS.md tree into a single `.github/copilot-instructions.md` target when Copilot becomes viable for Fabric.

**Rationale for deferral**

GitHub Copilot is not a Fabric v1.0 target client because Copilot MCP is not GA as of April 2026. Supporting it now would force Fabric into a fallback compilation path before the target platform is ready, while also weakening the MCP-first design that v1.0 is built around.

**Trigger for revisit**

Revisit when GitHub announces Copilot MCP general availability.

**Proposed approach sketch**

Add a `fab compile` command that flattens the AGENTS.md hierarchy into a single `.github/copilot-instructions.md` file. The output should include prominent warnings that structure, layering, and some Fabric semantics are compressed in the fallback target.
