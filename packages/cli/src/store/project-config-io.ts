// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Project config (<projectRoot>/.fabric/fabric-config.json).
//
// v2.1 global-refactor (W1-T2): the implementation moved to
// `@fenglimg/fabric-shared` so the MCP server can resolve the project's
// write-target / read-set without depending on the CLI package. This module
// re-exports the shared symbols verbatim — every existing CLI importer keeps
// its `./project-config-io` path unchanged.
// ---------------------------------------------------------------------------

export {
  projectConfigPath,
  loadProjectConfig,
  saveProjectConfig,
} from "@fenglimg/fabric-shared";
