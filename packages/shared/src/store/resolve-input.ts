import type { StoreResolveInput } from "../resolver/contracts.js";

import { loadGlobalConfig, resolveGlobalRoot } from "./global-config-io.js";
import { loadProjectConfig } from "./project-config-io.js";

// ---------------------------------------------------------------------------
// v2.1 global-refactor (W1-T2) — single source of truth for assembling the
// StoreResolveInput from the on-disk configs.
//
// Both the CLI (`scope-explain`, `bindings-io`) and the MCP server
// (`cross-store-recall` read-side, `extract-knowledge` write-side) need the
// SAME read-set / write-target resolution inputs. This builder reads the global
// config (uid + mounted stores) + the project config (required_stores +
// active_write_store) and shapes them into the resolver's plain-data input.
//
// Returns null when no global config exists (no stores mounted at all → the
// caller falls back to project-only / dual-root co-location behavior).
// ---------------------------------------------------------------------------

export function buildStoreResolveInput(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): StoreResolveInput | null {
  const global = loadGlobalConfig(globalRoot);
  if (global === null) {
    return null;
  }
  const project = loadProjectConfig(projectRoot);
  return {
    uid: global.uid,
    mountedStores: global.stores.map((s) => ({
      store_uuid: s.store_uuid,
      alias: s.alias,
      ...(s.remote === undefined ? {} : { remote: s.remote }),
      writable: s.writable ?? true,
      personal: s.personal ?? false,
    })),
    requiredStores: (project?.required_stores ?? []).map(
      (r: { id: string; suggested_remote?: string }) => ({
        id: r.id,
        ...(r.suggested_remote === undefined ? {} : { suggested_remote: r.suggested_remote }),
      }),
    ),
    ...(project?.active_write_store === undefined
      ? {}
      : { activeWriteAlias: project.active_write_store }),
  };
}
