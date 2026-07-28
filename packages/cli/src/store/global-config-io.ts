// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Global config (~/.fabric/fabric-global.json) load/save.
//
// v2.1 global-refactor (W1-T1): the implementation moved to
// `@fenglimg/fabric-shared` (packages/shared/src/store/global-config-io.ts) so
// the MCP server can resolve the mounted-store read-set on the recall path
// without depending on the CLI package. This module re-exports the shared
// symbols verbatim — every existing CLI importer keeps its `./global-config-io`
// path unchanged.
//
// config-single-home W1: production paths that MUTATE an existing config must
// use mutateGlobalConfig (load→mutate→save inside one lock).
// saveGlobalConfigAsync only locks the write, so a load-outside/save-inside
// caller still loses concurrent updates. saveGlobalConfigAsync stays valid for
// whole-config writes with no read-modify step (e.g. first-time creation);
// saveGlobalConfig stays for test fixtures.
// ---------------------------------------------------------------------------

export {
  resolveGlobalRoot,
  globalConfigPath,
  loadGlobalConfig,
  mutateGlobalConfig,
  saveGlobalConfig,
  saveGlobalConfigAsync,
} from "@fenglimg/fabric-shared";
