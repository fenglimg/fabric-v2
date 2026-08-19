// ---------------------------------------------------------------------------
// `POST /api/config/set` — change one value, at an EXPLICITLY named target.
//
// The predecessor inferred the target from the working directory: "this
// project" meant whichever repo the console was launched in. On a machine-scoped
// page that inference has nothing to stand on, so the target moves into the
// request — and the moment a client can name a target, naming becomes an attack
// surface. Two rules contain it:
//
//   1. Every target must be a MEMBER OF AN ENUMERATED SET the server itself
//      built — a project from the merged list, a store from the mount list.
//   2. The request never carries a PATH. Paths are derived server-side from a
//      uuid. A body that could say "write to /etc/..." would make this endpoint
//      an arbitrary-file writer reachable from any page the browser loads.
//
// The closed-set discipline on KEYS is inherited unchanged: anything outside
// `getPanelFields()` is refused, so a typo cannot land silently and a
// well-chosen key (`stores`, `uid`) cannot corrupt machine-wide state.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  getPanelFieldByKey,
  storeRelativePathForMount,
  type PanelFieldMeta,
} from "@fenglimg/fabric-shared";

import { loadGlobalConfig, resolveGlobalRoot } from "../store/global-config-io.js";
import { listRegisteredProjects } from "../store/project-registry-io.js";
import {
  asPlainObject,
  buildPanelContext,
  currentProjectIdOf,
  resetFieldValue,
  writeFieldValue,
} from "./config-resolve.js";
import { ARCHIVE_PRESET_KEYS, getArchivePreset } from "./config-presentation.js";
import { mergeProjectList } from "./project-list.js";

export type ConfigWriteResult =
  | { ok: true; target: string }
  | { ok: false; status: number; error: string };

export interface ConfigWriteRequest {
  key?: unknown;
  value?: unknown;
  target?: unknown;
  /** `"set"` (default) or `"reset"`. Anything else is refused, not defaulted. */
  action?: unknown;
}

/** Where a value is being written. Deliberately has no path-shaped member. */
type ResolvedTarget =
  | { scope: "machine" }
  | { scope: "project"; projectId: string }
  | { scope: "store"; storeRoot: string };

function bad(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

/**
 * `home` decides which targets are even meaningful.
 *
 * A corpus key written machine-wide, or a preference key written into a store,
 * would land in a file no reader consults for it — a write that reports success
 * and changes nothing, which is worse than a refusal because the user stops
 * looking for the real cause.
 */
function targetMatchesHome(home: PanelFieldMeta["home"], scope: ResolvedTarget["scope"]): boolean {
  if (home === "corpus") return scope === "store";
  if (home === "global_root") return scope === "machine";
  return scope === "machine" || scope === "project";
}

async function resolveTarget(
  raw: unknown,
  global: Record<string, unknown>,
  launchDir: string,
): Promise<ResolvedTarget | { ok: false; status: number; error: string }> {
  const target = asPlainObject(raw);
  const scope = target.scope;

  if (scope === "machine") return { scope: "machine" };

  if (scope === "project") {
    const projectId = target.projectId;
    if (typeof projectId !== "string" || projectId.length === 0) {
      return bad(400, "target.projectId is required");
    }
    // Membership in the SERVER's list, not merely "looks like an id". Accepting
    // an unknown id would create a config segment for a project that does not
    // exist — invisible junk that no page lists and no reader consults.
    //
    // The list must be built from the SAME three inputs the read side uses —
    // including `currentProjectId`. This argument was `null` at first, on the
    // reasoning that a machine-scoped page must not let the launch directory
    // decide anything. That confused two different roles the launch directory
    // plays: it must not REORDER or FILTER the list (it does not — mergeProjectList
    // only sets `isCurrent`), but it is the sole source of the synthesized row
    // for a project that neither the registry nor the config knows about
    // (project-list.ts:129). Dropping it here made the read and write sides
    // disagree about membership, so the console rendered an editable row for the
    // current project and every save against it answered 404 — and on any machine
    // installed before the registry existed, that is the ONLY project row there is.
    const known = mergeProjectList({
      registry: await listRegisteredProjects(),
      configuredIds: Object.keys(asPlainObject(global.projects)),
      currentProjectId: currentProjectIdOf(launchDir),
      currentProjectPath: launchDir,
    });
    const match = known.find((p) => p.projectId === projectId);
    if (match === undefined) return bad(404, `unknown project: ${projectId}`);
    if (!match.editable) return bad(409, `project has no id to store settings under: ${projectId}`);
    return { scope: "project", projectId };
  }

  if (scope === "store") {
    const storeUuid = target.storeUuid;
    if (typeof storeUuid !== "string" || storeUuid.length === 0) {
      return bad(400, "target.storeUuid is required");
    }
    const mounts = Array.isArray(global.stores) ? global.stores : [];
    const mount = mounts.map(asPlainObject).find((m) => m.store_uuid === storeUuid);
    if (mount === undefined) return bad(404, `store is not mounted: ${storeUuid}`);
    // The path is DERIVED here and never accepted from the request.
    const storeRoot = join(
      resolveGlobalRoot(),
      storeRelativePathForMount(mount as { store_uuid: string; mount_name?: string }),
    );
    // A mount entry can name a store whose directory is not on disk — mounted
    // but never synced. Writing anyway would create a lone `store-config.json`
    // in an empty tree: a directory that is not a store, holding settings
    // nothing reads. And the raw failure is an ENOENT naming a `.tmp` file,
    // which tells the user nothing about what to do.
    if (!existsSync(storeRoot)) {
      return bad(409, `store is mounted but not present on disk (run fabric sync): ${storeUuid}`);
    }
    return { scope: "store", storeRoot };
  }

  return bad(400, "target.scope must be one of: machine, project, store");
}

/**
 * @param launchDir the directory the console was started in — the same value
 * `collectGlobalConfigView` gets. It contributes exactly one thing: which
 * project id counts as "the one you are standing in" when deciding whether a
 * named project target is a member of the known set. Required rather than
 * defaulted so a caller cannot silently resolve a different set than the page
 * it is serving.
 */
export async function applyGlobalConfigEdit(
  body: ConfigWriteRequest | null | undefined,
  launchDir: string,
): Promise<ConfigWriteResult> {
  const key = body?.key;
  if (typeof key !== "string" || key.length === 0) {
    return bad(400, "key is required");
  }
  const field = getPanelFieldByKey(key);
  if (field === undefined) {
    return bad(400, `not a configurable key: ${key}`);
  }

  // Absent means `set` (every client that predates this field sends none);
  // anything else present must be one of the two. Falling back to `set` on an
  // unrecognised action would turn a typo'd `"clear"` into a write of whatever
  // `value` happened to hold — the opposite of what was asked, reported as
  // success.
  const rawAction = body?.action;
  if (rawAction !== undefined && rawAction !== "set" && rawAction !== "reset") {
    return bad(400, "action must be one of: set, reset");
  }
  const action: "set" | "reset" = rawAction === "reset" ? "reset" : "set";

  const global = asPlainObject(loadGlobalConfig(resolveGlobalRoot()));
  const target = await resolveTarget(body?.target, global, launchDir);
  if ("ok" in target) return target;

  if (!targetMatchesHome(field.home, target.scope)) {
    return bad(400, `${key} cannot be set at scope "${target.scope}"`);
  }

  // What gets persisted is validate's RETURN value, not the request's. That is
  // how `"42"` from an HTML input becomes the number 42 readers expect — writing
  // the string back would produce a value the page shows and nothing honours.
  // A reset carries no value, so it is not validated: requiring a valid value in
  // order to REMOVE one would strand any setting written by an older version or
  // hand-edited out of range — exactly the case reset exists for.
  let validatedValue: unknown;
  if (action === "set") {
    const raw = body?.value;
    const validated = field.validate(typeof raw === "string" ? raw : String(raw));
    if (!validated.ok) {
      return bad(400, validated.error);
    }
    validatedValue = validated.value;
  }

  // Targeting is expressed entirely by WHICH CONTEXT gets built; `writeFieldValue`
  // is the same function `fabric config` calls and knows nothing about scopes.
  const ctx = buildPanelContext({
    projectId: target.scope === "project" ? target.projectId : null,
    storeRoot: target.scope === "store" ? target.storeRoot : null,
    // Irrelevant to writing, and false is the honest value: this decides whether
    // env may DECIDE a read, and a write never consults it.
    applyEnv: false,
    global,
  });

  try {
    const written =
      action === "reset"
        ? await resetFieldValue(field, ctx, target.scope === "project")
        : await writeFieldValue(field, validatedValue, ctx, target.scope === "project");
    return { ok: true, target: written };
  } catch (error) {
    return bad(400, error instanceof Error ? error.message : String(error));
  }
}

export interface ConfigPresetRequest {
  preset?: unknown;
  target?: unknown;
}

export type ConfigPresetResult =
  | { ok: true; target: string; applied: readonly string[] }
  | {
      ok: false;
      status: number;
      error: string;
      /** Present only on a PARTIAL failure — see {@link applyGlobalConfigPreset}. */
      applied?: readonly string[];
      failed?: readonly { key: string; error: string }[];
    };

/**
 * `POST /api/config/preset` — apply one reminder-frequency preset.
 *
 * Eight keys, written one at a time through the SAME `writeFieldValue` a single
 * edit uses. Deliberately not a bulk write path: a second way to reach the
 * config file would be a second place for the home routing and validation to be
 * got wrong, and this endpoint's whole content is "do the thing the user could
 * have done eight times by hand".
 *
 * There is no rollback, and none is pretended. Each key lands in its own atomic
 * write, so a failure partway through leaves some applied — reporting "failed"
 * flat would tell the user their configuration is unchanged when half of it
 * changed, and they would go looking for the wrong problem. The partial result
 * names both sides so the page can say exactly what happened.
 */
export async function applyGlobalConfigPreset(
  body: ConfigPresetRequest | null | undefined,
  launchDir: string,
): Promise<ConfigPresetResult> {
  const presetId = body?.preset;
  if (typeof presetId !== "string" || presetId.length === 0) {
    return bad(400, "preset is required");
  }
  const preset = getArchivePreset(presetId);
  if (preset === undefined) {
    return bad(400, `unknown preset: ${presetId}`);
  }

  const global = asPlainObject(loadGlobalConfig(resolveGlobalRoot()));
  const target = await resolveTarget(body?.target, global, launchDir);
  if ("ok" in target) return target;
  // Every preset key is a `preference` field, so a store target could only ever
  // write into a file nothing reads it from.
  if (target.scope === "store") {
    return bad(400, 'reminder frequency cannot be set at scope "store"');
  }

  const ctx = buildPanelContext({
    projectId: target.scope === "project" ? target.projectId : null,
    storeRoot: null,
    applyEnv: false,
    global,
  });

  const applied: string[] = [];
  const failed: { key: string; error: string }[] = [];
  let written = "";
  for (const key of ARCHIVE_PRESET_KEYS) {
    const field = getPanelFieldByKey(key);
    // A preset key that is no longer a panel field means the schema moved and
    // this table did not. Skipping it loudly is better than writing it blind:
    // `writeFieldValue` needs the field's home to know where it even goes.
    if (field === undefined) {
      failed.push({ key, error: "not a configurable key" });
      continue;
    }
    try {
      written = await writeFieldValue(field, preset.values[key], ctx, target.scope === "project");
      applied.push(key);
    } catch (error) {
      failed.push({ key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failed.length > 0) {
    return {
      ...bad(409, `applied ${applied.length}/${ARCHIVE_PRESET_KEYS.length} settings`),
      applied,
      failed,
    };
  }
  return { ok: true, target: written, applied };
}
