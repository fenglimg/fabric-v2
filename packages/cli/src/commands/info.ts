import { defineCommand } from "citty";

import { FabricError } from "@fenglimg/fabric-shared/errors";

import { getProjectTranslator } from "../i18n.js";
import { warnUnknownFlags } from "../lib/unknown-flags.js";
import { whoami, projectStatus } from "../store/info-ops.js";
import { scopeExplain } from "../store/scope-explain.js";

// ---------------------------------------------------------------------------
// EPIC-010: Unified `fabric info` command combining whoami/status/scope-explain.
//
// Usage:
//   fabric info              → project status (原 status)
//   fabric info --global     → global identity (原 whoami)
//   fabric info scope <path> → scope resolution (原 scope-explain)
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "info",
    description: "Unified information command for Fabric identity, project status, and scope resolution",
  },
  args: {
    // Subcommand detection
    subcommand: {
      type: "positional",
      required: false,
      description: "Subcommand: 'scope' for scope explanation",
    },
    scope: {
      type: "positional",
      required: false,
      description: "Scope coordinate (used with 'scope' subcommand)",
    },
    // Flags
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
  run({ args }: { args: { subcommand?: string; scope?: string; global?: boolean; json?: boolean } }) {
    warnUnknownFlags(["global", "g", "json"]);

    // Determine which mode to run
    const mode = resolveMode(args);

    switch (mode) {
      case "whoami":
        runWhoami(args.json);
        break;
      case "scope-explain":
        if (typeof args.scope !== "string" || args.scope.length === 0) {
          console.error("Usage: fabric info scope <scope>");
          process.exitCode = 1;
          break;
        }
        runScopeExplain(args.scope!);
        break;
      case "status":
      default:
        runStatus(args.json);
        break;
    }
  },
});

// ---------------------------------------------------------------------------
// Mode resolution logic
// ---------------------------------------------------------------------------

type InfoMode = "whoami" | "status" | "scope-explain";

function resolveMode(args: {
  subcommand?: string;
  scope?: string;
  global?: boolean;
}): InfoMode {
  // Explicit subcommand takes priority
  if (args.subcommand === "scope") {
    return "scope-explain";
  }

  // --global flag triggers whoami
  if (args.global === true) {
    return "whoami";
  }

  // Default to project status
  return "status";
}

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
