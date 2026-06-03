import { loadGlobalConfig, resolveGlobalRoot } from "./global-config-io.js";
import { loadProjectConfig } from "./project-config-io.js";
import { storeGitRemote } from "./store-ops.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — read-only info ops backing `fabric whoami` / `fabric status`
// (S30/F5). Pure reads of the global + project configs; no mutation.
// ---------------------------------------------------------------------------

export interface WhoamiInfo {
  uid: string;
  stores: Array<{ alias: string; store_uuid: string; local_only: boolean }>;
}

// Machine identity + mounted stores. Null when no global config exists yet.
export function whoami(globalRoot: string = resolveGlobalRoot()): WhoamiInfo | null {
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    return null;
  }
  return {
    uid: config.uid,
    stores: config.stores.map((s) => ({
      alias: s.alias,
      store_uuid: s.store_uuid,
      // F4: parity with `fabric store list` — local-only reflects the store
      // repo's TRUE git remote (what sync actually pushes to), not the registry
      // metadata. A store with a physical `origin` but no registry `remote`
      // (e.g. the personal store) was misreported as local-only by whoami while
      // `store list` honestly showed its remote. Both now read the same source.
      local_only: storeGitRemote(s.store_uuid, globalRoot) === undefined,
    })),
  };
}

export interface ProjectStatus {
  uid: string | null;
  mounted: string[];
  project_id: string | null;
  // F9: distinguishes "no project config at all" from "project config exists
  // but project_id is unset" (the common case — project_id assignment is part
  // of the deferred global-refactor and not yet populated at install). Without
  // this, `fabric status` misreports every installed project as "(not a Fabric
  // project)" purely because project_id is null.
  is_fabric_project: boolean;
  required: string[];
  active_write_store: string | null;
}

// Cross-config project status: who am I (global) + what this project requires
// and writes to (project). Degrades field-by-field when either config is absent.
export function projectStatus(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): ProjectStatus {
  const global = loadGlobalConfig(globalRoot);
  const project = loadProjectConfig(projectRoot);
  return {
    uid: global?.uid ?? null,
    mounted: (global?.stores ?? []).map((s) => s.alias),
    project_id: project?.project_id ?? null,
    is_fabric_project: project !== null,
    required: (project?.required_stores ?? []).map((r) => r.id),
    active_write_store: project?.active_write_store ?? null,
  };
}
