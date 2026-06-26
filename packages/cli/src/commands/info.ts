import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { defineCommand } from "citty";

import { FabricError } from "@fenglimg/fabric-shared/errors";
import {
  readEmbedConfig,
  readFusion,
  loadEmbedder,
  defaultEmbedCacheDir,
  OPTIONAL_EMBED_PACKAGE,
} from "@fenglimg/fabric-server";

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

// P1 recall-engine-refactor (follow-up): `fabric info recall` — the single place
// to see the recall engine's actual state (which fusion strategy is in effect +
// whether the vector channel can fire). `--warm` actively loads the embedder,
// downloading the model on first run.
const recallCommand = defineCommand({
  meta: {
    name: "recall",
    description: "Show recall-engine status (fusion strategy + embedding state); --warm downloads the model",
  },
  args: {
    warm: {
      type: "boolean",
      description: "Load the embedder now (downloads the model to ~/.fabric/cache/embed on first run)",
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON instead of text",
    },
  },
  async run({ args }: { args: { warm?: boolean; json?: boolean } }) {
    warnUnknownFlags(["warm", "json"]);
    if (args.warm === true) {
      await runRecallWarm(args.json);
      return;
    }
    runRecallStatus(args.json);
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
    recall: recallCommand,
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

// ---------------------------------------------------------------------------
// `fabric info recall` — recall-engine status.
// ---------------------------------------------------------------------------

export interface RecallEngineStatus {
  /** Configured fusion (raw): additive | rrf | auto (default). */
  fusion_configured: "additive" | "rrf" | "auto";
  /** What `auto` resolves to given the probes below (or the forced mode). */
  fusion_effective: "additive" | "rrf";
  /** Why fusion_effective came out the way it did. */
  fusion_reason: string;
  embed_enabled: boolean;
  embed_model: string;
  /** Is the optional `fastembed` package resolvable (a proxy for "installed")? */
  fastembed_resolvable: boolean;
  /** Stable model cache dir (~/.fabric/cache/embed unless FABRIC_EMBED_CACHE_DIR). */
  model_cache_dir: string;
  /** Does that cache already hold the configured model's files? */
  model_cached: boolean;
  /** True when the vector channel can actually fire (enabled + pkg + model). */
  vector_ready: boolean;
}

function isFastembedResolvable(): boolean {
  try {
    createRequire(import.meta.url).resolve(OPTIONAL_EMBED_PACKAGE);
    return true;
  } catch {
    return false;
  }
}

function isModelCached(cacheDir: string, model: string): boolean {
  try {
    const modelDir = join(cacheDir, model);
    return existsSync(modelDir) && readdirSync(modelDir).length > 0;
  } catch {
    return false;
  }
}

export function gatherRecallStatus(projectRoot: string): RecallEngineStatus {
  const fusionConfigured = readFusion(projectRoot);
  const embed = readEmbedConfig(projectRoot);
  const cacheDir = defaultEmbedCacheDir();
  const fastembedResolvable = isFastembedResolvable();
  const modelCached = isModelCached(cacheDir, embed.model);
  // vector_ready predicts whether the vector channel will actually score: enabled
  // + package present + model already on disk. (A cold model still downloads on
  // first recall, but until then `auto` plays it safe with additive.)
  const vectorReady = embed.enabled && fastembedResolvable && modelCached;

  let fusionEffective: "additive" | "rrf";
  let fusionReason: string;
  if (fusionConfigured === "additive") {
    fusionEffective = "additive";
    fusionReason = "forced additive (config)";
  } else if (fusionConfigured === "rrf") {
    fusionEffective = "rrf";
    fusionReason = vectorReady
      ? "forced rrf (config); vector channel ready"
      : "forced rrf (config) — WARNING: vector channel not ready, rrf is single-channel and worse than additive";
  } else {
    fusionEffective = vectorReady ? "rrf" : "additive";
    fusionReason = vectorReady
      ? "auto → rrf (vector channel ready)"
      : "auto → additive (vector channel not ready: " +
        [
          embed.enabled ? null : "embed_enabled=false",
          fastembedResolvable ? null : "fastembed not resolvable",
          modelCached ? null : "model not cached",
        ]
          .filter(Boolean)
          .join(", ") +
        ")";
  }

  return {
    fusion_configured: fusionConfigured,
    fusion_effective: fusionEffective,
    fusion_reason: fusionReason,
    embed_enabled: embed.enabled,
    embed_model: embed.model,
    fastembed_resolvable: fastembedResolvable,
    model_cache_dir: cacheDir,
    model_cached: modelCached,
    vector_ready: vectorReady,
  };
}

function runRecallStatus(json?: boolean) {
  const status = gatherRecallStatus(process.cwd());
  if (json === true) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`fusion (config):   ${status.fusion_configured}`);
  console.log(`fusion (in use):   ${status.fusion_effective}  — ${status.fusion_reason}`);
  console.log(`embed_enabled:     ${status.embed_enabled}`);
  console.log(`embed_model:       ${status.embed_model}`);
  console.log(`fastembed package: ${status.fastembed_resolvable ? "resolvable" : "NOT resolvable (optional dep not installed)"}`);
  console.log(`model cache dir:   ${status.model_cache_dir}`);
  console.log(`model cached:      ${status.model_cached ? "yes" : "no (downloads on first recall, or run `fabric info recall --warm`)"}`);
  console.log(`vector channel:    ${status.vector_ready ? "READY" : "not ready (recall falls back to BM25-only / additive)"}`);
}

async function runRecallWarm(json?: boolean) {
  const projectRoot = process.cwd();
  const embed = readEmbedConfig(projectRoot);
  const cacheDir = defaultEmbedCacheDir();
  // Actively load the embedder — this triggers the model download on a cold cache.
  const embedder = await loadEmbedder(embed.model);
  let dim: number | null = null;
  let ok = embedder !== null;
  if (embedder !== null) {
    try {
      const vecs = await embedder.embed(["fabric recall warm probe"]);
      dim = vecs[0]?.length ?? null;
    } catch {
      ok = false;
    }
  }
  const result = { warmed: ok, embed_model: embed.model, model_cache_dir: cacheDir, vector_dim: dim };
  if (json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (ok) {
    console.log(`✓ embedder warm: model '${embed.model}' loaded (vector dim ${dim ?? "?"}), cached at ${cacheDir}`);
  } else {
    console.log(
      `✗ embedder unavailable — the optional 'fastembed' package is not resolvable or the model failed to load.\n` +
        `  Recall falls back to BM25-only / additive. Install fastembed where the server resolves modules, then retry.`,
    );
    process.exitCode = 1;
  }
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
