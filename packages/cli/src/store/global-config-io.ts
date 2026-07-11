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
// ISS-20260711-256: production mutation paths must use saveGlobalConfigAsync
// (withFileLock + atomicWriteJson). saveGlobalConfig stays for test fixtures.
// ---------------------------------------------------------------------------

export {
  resolveGlobalRoot,
  globalConfigPath,
  loadGlobalConfig,
  saveGlobalConfig,
  saveGlobalConfigAsync,
} from "@fenglimg/fabric-shared";
