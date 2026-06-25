import { z } from "zod";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0 — Resolver CONTRACTS (interfaces + golden-case meta-schemas).
//
// Surfaces: S15/S32/S45 (ProjectRootResolver: four-signal project root, one
// repo = one .fabric = one project_id, worktree merged by project_id) ·
// S11/S54 (read-set) · S60 (write-target layering) · S55 (alias↔UUID) ·
// S51 (missing-store warnings).
//
// PURE DEFINITION LAYER. This file declares the TS interfaces both resolvers
// must satisfy and the meta-schemas for the golden fixtures (resolver/golden/
// *.json). It runs NOTHING. The implementation is TDD'd in P0.6 against the
// golden fixtures, which P0.5 instantiates as an xfail/red-suite.
// ---------------------------------------------------------------------------

// ===========================================================================
// ProjectRootResolver (S15/S32/S45)
// ===========================================================================

// Resolution precedence, highest first. The resolver walks these in order and
// returns the first that yields a project root:
//   env    — `FABRIC_PROJECT_ROOT` env var (explicit override)
//   marker — nearest ancestor dir containing `.fabric/fabric-config.json`
//   cwd    — the current working directory itself carries the marker
//   repo   — git repository root (fallback when no .fabric marker found)
export const PROJECT_ROOT_SIGNALS = ["env", "marker", "cwd", "repo"] as const;
export const projectRootSignalSchema = z.enum(PROJECT_ROOT_SIGNALS);
export type ProjectRootSignal = z.infer<typeof projectRootSignalSchema>;

// Inputs available to the resolver. `cwd` is always present; the others are
// supplied when the environment/filesystem provides them. Modeled as plain
// data so the resolver stays pure/testable (no direct fs/env access in the
// contract — the impl wires real signal collection in P0.6).
//
// Precedence (highest first), applied by `resolve`:
//   env > markerDir > repoRoot   (and bare cwd with no marker/repo → null)
// The `signalUsed` distinguishes a cwd-self marker from an ancestor marker by
// comparing `markerDir` to `cwd` (markerDir === cwd → "cwd", else "marker").
// This makes all four signals reachable while honoring "one repo = one .fabric
// = one project_id" — see ADJ-P0-1 and project-root.golden.json.
export const projectRootSignalsSchema = z
  .object({
    // FABRIC_PROJECT_ROOT, if set.
    env: z.string().optional(),
    // Nearest directory AT-OR-ABOVE cwd holding `.fabric/fabric-config.json`,
    // if any (the upward marker search result; may equal cwd).
    markerDir: z.string().optional(),
    // Always present — the process cwd.
    cwd: z.string().min(1),
    // git repo root, if inside a repo.
    repoRoot: z.string().optional(),
    // The `project_id` read from the winning root's fabric-config.json during
    // (fs) signal collection. The pure resolver echoes it — it cannot invent a
    // UUID. Worktrees of one repo share the committed config, hence the same
    // project_id (S45 merge). Absent when no .fabric config exists at the root
    // yet (fresh repo-fallback) → resolution still yields the root with a null
    // projectId so the caller can mint+persist one at install time.
    discoveredProjectId: z.string().optional(),
  })
  .strict();
export type ProjectRootSignals = z.infer<typeof projectRootSignalsSchema>;

export const projectRootResolutionSchema = z
  .object({
    // Absolute project root directory.
    projectRoot: z.string().min(1),
    // Stable project identity. One repo = one .fabric = one project_id (S32);
    // git worktrees of the same repo resolve to the SAME project_id (S45).
    // Null when the resolved root has no fabric-config.json yet (fresh
    // repo-fallback) — the caller mints + persists a UUID at install time.
    projectId: z.string().min(1).nullable(),
    // Which signal won.
    signalUsed: projectRootSignalSchema,
  })
  .strict();
export type ProjectRootResolution = z.infer<typeof projectRootResolutionSchema>;

export interface ProjectRootResolver {
  // Returns the resolved root, or null when no signal yields one (e.g. cwd is
  // not inside any project and not a repo — caller surfaces a clear error).
  resolve(signals: ProjectRootSignals): ProjectRootResolution | null;
}

// ===========================================================================
// StoreResolver (S11/S54/S60/S55/S51)
// ===========================================================================

// A reason a required/expected store could not be included in the read-set.
export const STORE_RESOLVER_WARNING_CODES = [
  "missing_store", // required_stores entry has no matching mounted store (S51)
  "local_only_no_remote", // mounted but local-only (R5#5 nudge, non-fatal)
  "alias_unresolved", // referenced alias maps to no mounted store
  "missing_write_route", // multi/shared write requires an explicit route
] as const;
export const storeResolverWarningCodeSchema = z.enum(STORE_RESOLVER_WARNING_CODES);
export type StoreResolverWarningCode = z.infer<typeof storeResolverWarningCodeSchema>;

export const storeResolverWarningSchema = z
  .object({
    code: storeResolverWarningCodeSchema,
    // The alias/UUID/id the warning concerns.
    ref: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type StoreResolverWarning = z.infer<typeof storeResolverWarningSchema>;

// One entry of the resolved read-set. The read-set is the EXPLICIT union of the
// project's required_stores ∪ the implicit personal store (S11) — the resolver
// NEVER reads a store the project did not declare.
export const readSetEntrySchema = z
  .object({
    store_uuid: z.string().min(1),
    alias: z.string().min(1),
    remote: z.string().min(1).optional(),
    // Whether this store accepts writes from the current context. Personal
    // store is writable; shared stores writable iff mounted with write intent.
    writable: z.boolean(),
  })
  .strict();
export type ReadSetEntry = z.infer<typeof readSetEntrySchema>;

export const storeReadSetSchema = z
  .object({
    stores: z.array(readSetEntrySchema),
    warnings: z.array(storeResolverWarningSchema),
  })
  .strict();
export type StoreReadSet = z.infer<typeof storeReadSetSchema>;

// The single store a write lands in (S60). Chosen from the read-set's writable
// stores given the entry's scope (personal scope → personal store; otherwise
// the active write store). Layering is deterministic and explainable.
export const writeTargetSchema = z
  .object({
    store_uuid: z.string().min(1),
    alias: z.string().min(1),
  })
  .strict();
export type WriteTarget = z.infer<typeof writeTargetSchema>;

// Inputs to read-set/write-target resolution. Plain data (no fs/git) so the
// contract is pure; the P0.6 impl assembles these from global config + project
// config + the resolved project root.
export const storeResolveInputSchema = z
  .object({
    // Machine identity (S33) — namespaces personal ids; identifies personal store.
    uid: z.string().min(1),
    // Stores mounted on this machine (from global config).
    mountedStores: z.array(
      z
        .object({
          store_uuid: z.string().min(1),
          alias: z.string().min(1),
          mount_name: z.string().min(1).optional(),
          remote: z.string().min(1).optional(),
          writable: z.boolean().default(true),
          // Marks the implicit personal store.
          personal: z.boolean().default(false),
        })
        .strict(),
    ),
    // The project's declared required_stores (ids/aliases + optional remote).
    requiredStores: z.array(
      z
        .object({
          id: z.string().min(1),
          suggested_remote: z.string().min(1).optional(),
        })
        .strict(),
    ),
    // Alias selected as the active write store for non-personal scopes, if any.
    activeWriteAlias: z.string().min(1).optional(),
    // Alias/UUID of the ACTIVE personal store among possibly-many mounted
    // `personal:true` stores (语义 A: singleton-at-a-time). Drives the SINGLE
    // personal choke point (findPersonal) → both read-set inclusion and the
    // personal-scope write-target. Absent or dangling ⇒ the resolver falls back
    // to the first mounted personal, so legacy single-personal configs are
    // unchanged. Sourced from `~/.fabric/fabric-global.json` → active_personal_store.
    activePersonalAlias: z.string().min(1).optional(),
    // Scope-aware write routes. Exact scope wins first, then longest prefix route.
    writeRoutes: z
      .array(
        z
          .object({
            scope: z.string().min(1),
            store: z.string().min(1),
          })
          .strict(),
      )
      .optional()
      .default([]),
    defaultWriteAlias: z.string().min(1).optional(),
  })
  .strict();
export type StoreResolveInput = z.infer<typeof storeResolveInputSchema>;

export interface StoreResolver {
  // required_stores ∪ implicit personal (S11/S54); missing → warning (S51).
  resolveReadSet(input: StoreResolveInput): StoreReadSet;
  // The store a write of `scope` lands in (S60); null + warning if none writable.
  resolveWriteTarget(
    input: StoreResolveInput,
    scope: string,
  ): { target: WriteTarget | null; warnings: StoreResolverWarning[] };
  // alias → store UUID (S55); undefined when the alias is not mounted.
  aliasToUuid(input: StoreResolveInput, alias: string): string | undefined;
}

// ===========================================================================
// Golden-case meta-schemas (resolver/golden/*.json)
//
// These validate the EXPECTED-VALUE fixture files written in P0. P0.5 loads the
// fixtures and asserts the (not-yet-implemented) resolver against them as an
// xfail/red-suite; P0.6 turns them green.
// ===========================================================================

export const projectRootGoldenCaseSchema = z
  .object({
    name: z.string().min(1),
    note: z.string().optional(),
    signals: projectRootSignalsSchema,
    // null expected = resolver should return no root for these signals.
    expected: projectRootResolutionSchema.nullable(),
  })
  .strict();
export type ProjectRootGoldenCase = z.infer<typeof projectRootGoldenCaseSchema>;

export const projectRootGoldenFileSchema = z
  .object({
    contract: z.literal("project-root.golden"),
    cases: z.array(projectRootGoldenCaseSchema).min(1),
  })
  .strict();

export const readSetGoldenCaseSchema = z
  .object({
    name: z.string().min(1),
    note: z.string().optional(),
    input: storeResolveInputSchema,
    // Scope under test for the write-target expectation.
    writeScope: z.string().min(1),
    expected: z
      .object({
        readSet: storeReadSetSchema,
        writeTarget: writeTargetSchema.nullable(),
        writeWarnings: z.array(storeResolverWarningSchema),
      })
      .strict(),
  })
  .strict();
export type ReadSetGoldenCase = z.infer<typeof readSetGoldenCaseSchema>;

export const readSetGoldenFileSchema = z
  .object({
    contract: z.literal("read-set.golden"),
    cases: z.array(readSetGoldenCaseSchema).min(1),
  })
  .strict();
