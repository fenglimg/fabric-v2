// ---------------------------------------------------------------------------
// config-single-home W6 — the panel's read/write router.
//
// W5 moved every policy knob out of `.fabric/fabric-config.json` but only
// rerouted the non-interactive `--set` path. The interactive panel and
// `--list` / `--get` kept reading and writing the repo file, so the panel
// showed `null` for every field (the repo config is identity-only) and an edit
// made there was persisted into a file no reader consults. These helpers give
// all three surfaces ONE resolver keyed off `PanelFieldMeta.home`, so what the
// panel displays is what the hooks and the server actually resolve.
//
// Moved verbatim out of commands/config.ts when the console gained a config
// page: the CLI panel and the web page must not each own a copy of "what value
// is in effect and where did it come from". Two implementations of one question
// is the second-state problem the whole single-home redesign removed — a page
// that says "machine-wide" while `fabric config` says "team store" is unrunnable
// to debug.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  STORE_LAYOUT,
  buildStoreResolveInput,
  createStoreResolver,
  envOverrideFor,
  storeConfigSchema,
  storeRelativePathForMount,
  type PanelFieldMeta,
} from "@fenglimg/fabric-shared";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";

import { t } from "../i18n.js";
import { loadGlobalConfig, mutateGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";

// `.fabric/fabric-config.json` — panel-managed config. Identity-only since W5;
// read here for `project_id`, which is the key into the global `projects` map.
const PANEL_CONFIG_RELATIVE_PATH = [".fabric", "fabric-config.json"] as const;

/**
 * Resolve the TEAM write-target store ROOT for `--scope store` writes. Mirrors
 * the server's config-loader.resolveStoreConfig target resolution so a value set
 * here is read back by exactly the same layer. null on any miss (unbound repo,
 * no write target) so the caller can fail with actionable guidance.
 */
export function resolveWriteTargetStoreRoot(projectRoot: string): string | null {
  try {
    const input = buildStoreResolveInput(projectRoot);
    if (input === null) {
      return null;
    }
    let activeProject: string | undefined;
    try {
      const raw: unknown = JSON.parse(
        readFileSync(join(projectRoot, ".fabric", "fabric-config.json"), "utf8"),
      );
      if (raw !== null && typeof raw === "object") {
        const candidate = (raw as { active_project?: unknown }).active_project;
        activeProject = typeof candidate === "string" ? candidate : undefined;
      }
    } catch {
      activeProject = undefined;
    }
    const scope =
      activeProject !== undefined && activeProject.length > 0 ? `project:${activeProject}` : "team";
    const { target } = createStoreResolver().resolveWriteTarget(input, scope);
    if (target === null) {
      return null;
    }
    const mounted = input.mountedStores.find((s) => s.store_uuid === target.store_uuid) ?? {
      store_uuid: target.store_uuid,
    };
    return join(resolveGlobalRoot(), storeRelativePathForMount(mounted));
  } catch {
    return null;
  }
}

/** Which layer supplied the effective value (used for the panel's provenance tag). */
export type ValueSource = "env" | "project" | "defaults" | "store" | "global" | "default";

export interface PanelContext {
  readonly workspaceRoot: string;
  /** From the repo config — the key into the global `projects` map. */
  readonly projectId: string | null;
  readonly global: Record<string, unknown>;
  readonly storeConfig: Record<string, unknown>;
  readonly storeRoot: string | null;
  /**
   * Whether `process.env` may decide a value here.
   *
   * True is only honest when THIS process's environment stands in for the
   * environment of the process that actually reads the variable — the CLI panel
   * (same shell as the user) and the console's own project. It is false for
   * every other project on the machine: `FABRIC_NUDGE_MODE` is read by each
   * project's hook processes, and the console has no window into those. Claiming
   * otherwise would describe one process's environment as another's, which is
   * the "the value you see is not the value in effect" failure (KT-MOD-0004)
   * manufactured by the display itself.
   */
  readonly applyEnv: boolean;
}

export function asPlainObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    return asPlainObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

/**
 * Build a context for an EXPLICIT target — a project id and a store root the
 * caller already decided on.
 *
 * The console's machine-scoped page needs to resolve values for a project it is
 * not sitting in, and to write into a store the current repo may not even mount.
 * Both are just "a different `projectId` / `storeRoot`", so the whole targeting
 * question collapses into which context you build; `resolveEffective` and
 * `writeFieldValue` need no knowledge of it.
 */
export function buildPanelContext(input: {
  projectId: string | null;
  storeRoot: string | null;
  applyEnv: boolean;
  /** Reuse an already-parsed global config; re-read per call when omitted. */
  global?: Record<string, unknown>;
}): PanelContext {
  return {
    // No workspace is involved in an explicitly targeted context. Kept on the
    // shape because the CLI panel's error messages still name the repo.
    workspaceRoot: "",
    projectId: input.projectId,
    global: input.global ?? asPlainObject(loadGlobalConfig(resolveGlobalRoot())),
    storeConfig:
      input.storeRoot === null
        ? {}
        : readJsonObject(join(input.storeRoot, STORE_LAYOUT.configFile)),
    storeRoot: input.storeRoot,
    applyEnv: input.applyEnv,
  };
}

/**
 * Derive a context from a workspace: `project_id` out of the repo's identity
 * config, store root out of that repo's write target.
 *
 * `applyEnv` is true here because both callers — `fabric config` and the
 * console's current-project row — run in the user's own shell.
 */
export function loadPanelContext(workspaceRoot: string): PanelContext {
  const repo = readJsonObject(join(workspaceRoot, ...PANEL_CONFIG_RELATIVE_PATH));
  const projectIdRaw = repo.project_id;
  const storeRoot = resolveWriteTargetStoreRoot(workspaceRoot);
  return {
    ...buildPanelContext({
      projectId:
        typeof projectIdRaw === "string" && projectIdRaw.length > 0 ? projectIdRaw : null,
      storeRoot,
      applyEnv: true,
    }),
    workspaceRoot,
  };
}

/**
 * The value a reader would actually resolve for this field, plus the layer it
 * came from. Mirrors the server cascade (config-loader.resolvePreference /
 * resolveCorpus) and the hook twin (lib/config-cache.readPolicy).
 *
 * The env layer is consulted ONLY for keys in `PANEL_ENV_OVERRIDES`. It used to
 * be omitted entirely, with the reasoning that "not every knob has an env
 * reader, so claiming one would be a display that lies" — correct, but it picked
 * the wrong half: for the four keys that DO have a reader, the panel reported
 * `machine-wide` while the environment was the thing actually deciding. The
 * registry lets the env layer be shown exactly where it is real.
 *
 * A malformed env value falls THROUGH to the config layers rather than
 * poisoning the field — the never-throw fallthrough contract every layer here
 * follows (KT-MOD-0002).
 */
export function resolveEffective(
  field: PanelFieldMeta,
  ctx: PanelContext,
): { value: unknown; source: ValueSource } {
  const key = field.key as string;

  const envVar = ctx.applyEnv ? envOverrideFor(key) : null;
  if (envVar !== null) {
    const raw = process.env[envVar];
    if (raw !== undefined && raw.length > 0) {
      const parsed = field.validate(raw);
      if (parsed.ok) {
        return { value: parsed.value, source: "env" };
      }
    }
  }

  if (field.home === "global_root") {
    const value = ctx.global.language;
    return value === undefined ? { value: undefined, source: "default" } : { value, source: "global" };
  }
  if (field.home === "corpus") {
    const value = ctx.storeConfig[key];
    return value === undefined ? { value: undefined, source: "default" } : { value, source: "store" };
  }
  const projects = asPlainObject(ctx.global.projects);
  const scoped = ctx.projectId === null ? {} : asPlainObject(projects[ctx.projectId]);
  if (scoped[key] !== undefined) {
    return { value: scoped[key], source: "project" };
  }
  const defaults = asPlainObject(ctx.global.defaults);
  if (defaults[key] !== undefined) {
    return { value: defaults[key], source: "defaults" };
  }
  return { value: undefined, source: "default" };
}

/**
 * Persist a panel value into the field's ONE home. `preferProjectScope` picks
 * between the two preference segments (`projects[<id>]` vs `defaults`); it is
 * ignored for corpus / global-root fields, which have a single possible target.
 * Returns a human-readable description of where the value landed.
 */
export async function writeFieldValue(
  field: PanelFieldMeta,
  value: unknown,
  ctx: PanelContext,
  preferProjectScope: boolean,
): Promise<string> {
  const key = field.key as string;

  if (field.home === "global_root") {
    await mutateGlobalConfig(
      (current) => ({
        ...(current ?? { uid: "local", stores: [] }),
        language: value as "zh-CN" | "en",
      }),
      resolveGlobalRoot(),
    );
    return "global language";
  }

  if (field.home === "corpus") {
    if (ctx.storeRoot === null) {
      throw new Error(t("cli.config.errors.no-store-target"));
    }
    const storeConfigPath = join(ctx.storeRoot, STORE_LAYOUT.configFile);
    const next = storeConfigSchema.parse({ ...ctx.storeConfig, [key]: value });
    await atomicWriteJson(storeConfigPath, next);
    return `store: ${storeConfigPath}`;
  }

  const useProject = preferProjectScope && ctx.projectId !== null;
  if (preferProjectScope && ctx.projectId === null) {
    throw new Error(t("cli.config.errors.no-project-id"));
  }
  await mutateGlobalConfig((current) => {
    const base = current ?? { uid: "local", stores: [] };
    if (!useProject) {
      return { ...base, defaults: { ...(base.defaults ?? {}), [key]: value } };
    }
    const projects = { ...(base.projects ?? {}) };
    projects[ctx.projectId as string] = {
      ...(projects[ctx.projectId as string] ?? {}),
      [key]: value,
    };
    return { ...base, projects };
  });
  return useProject ? `global projects.${ctx.projectId as string}` : "global defaults";
}
