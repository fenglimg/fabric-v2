import { defineCommand } from "citty";

import { FabricError } from "@fenglimg/fabric-shared/errors";

import { getProjectTranslator } from "../i18n.js";
import { warnUnknownFlags } from "../lib/unknown-flags.js";
import { whoami, projectStatus } from "../store/info-ops.js";
import { scopeExplain } from "../store/scope-explain.js";

// ---------------------------------------------------------------------------
// EPIC-010 / W3-F: Unified `fabric info` command combining whoami/status/scope.
//
// Usage:
//   fabric info               → project status (原 status)
//   fabric info --global      → global identity (原 whoami)
//   fabric info scope <coord> → scope resolution (real subcommand; 原 scope-explain)
//
// W3-F (NS-01 §1/I1): `scope` was a positional-detected pseudo-subcommand; it is
// now a real citty subCommand, so `fabric info scope --help` works and `coord`
// is a citty-validated required positional. Skills resolve the read-set / write
// target via `fabric info scope <coord>` (JSON) — the retired top-level
// `scope-explain` command shared this exact resolver.
// ---------------------------------------------------------------------------

const scopeCommand = defineCommand({
  meta: {
    name: "scope",
    description: "Resolve a scope coordinate's read-set + write target (JSON)",
  },
  args: {
    coord: {
      type: "positional",
      required: true,
      description: "Scope coordinate (e.g. team, project:x, personal)",
    },
    // Accepted for symmetry with other commands; scope output is always JSON.
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (scope always emits JSON)",
    },
  },
  run({ args }: { args: { coord: string } }) {
    warnUnknownFlags(["json"]);
    runScopeExplain(args.coord);
  },
});

export default defineCommand({
  meta: {
    name: "info",
    description: "Unified information command for Fabric identity, project status, and scope resolution",
  },
  args: {
    global: {
      type: "boolean",
      description: "Show global identity (whoami) instead of project status",
      alias: "g",
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON instead of text",
    },
  },
  subCommands: {
    scope: scopeCommand,
  },
  run({ args }: { args: { global?: boolean; json?: boolean } }) {
    warnUnknownFlags(["global", "g", "json"]);
    if (args.global === true) {
      runWhoami(args.json);
      return;
    }
    runStatus(args.json);
  },
});

// ---------------------------------------------------------------------------
// Command implementations (ported from original commands)
// ---------------------------------------------------------------------------

function runWhoami(json?: boolean) {
  const info = whoami();
  if (json === true) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  const t = getProjectTranslator();
  if (info === null) {
    console.log(t("cli.cmd.no-global-config"));
    return;
  }
  console.log(t("cli.whoami.uid", { uid: info.uid }));
  if (info.stores.length === 0) {
    console.log(t("cli.whoami.stores-none"));
    return;
  }
  console.log(t("cli.whoami.stores-label"));
  const localOnly = t("cli.shared.local-only");
  for (const store of info.stores) {
    console.log(
      `  ${store.alias}\t${store.mount_name ?? store.store_uuid}\t${store.store_uuid}${store.local_only ? `\t${localOnly}` : ""}`,
    );
  }
}

function runStatus(json?: boolean) {
  const status = projectStatus(process.cwd());
  if (json === true) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`uid:            ${status.uid ?? "(no global config)"}`);
  // F9: only call it "not a Fabric project" when there is genuinely no
  // project config. When the project IS initialized but project_id is unset
  // (deferred global-refactor), say "(unset)" instead of lying.
  const projectIdLabel = status.project_id ?? (status.is_fabric_project ? "(unset)" : "(not a Fabric project)");
  console.log(`project_id:     ${projectIdLabel}`);
  console.log(`mounted stores: ${status.mounted.length > 0 ? status.mounted.join(", ") : "(none)"}`);
  console.log(`required:       ${status.required.length > 0 ? status.required.join(", ") : "(none)"}`);
  console.log(`default write:  ${status.default_write_store ?? status.active_write_store ?? "(none — personal scope only)"}`);
  console.log(`write routes:   ${status.write_routes.length}`);
}

function runScopeExplain(scope: string) {
  const projectRoot = process.cwd();
  let result;
  try {
    result = scopeExplain(projectRoot, scope);
  } catch (error) {
    // F21: a malformed scope coordinate fails loudly + actionably instead of
    // silently resolving to a fallback target.
    if (error instanceof FabricError) {
      console.error(`${error.message}\n→ ${error.actionHint}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (result === null) {
    console.log(getProjectTranslator(projectRoot)("cli.cmd.no-global-config"));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}
