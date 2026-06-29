import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { defineCommand } from "citty";

import { FabricError } from "@fenglimg/fabric-shared/errors";
import {
  readEmbedConfig,
  readFusion,
  loadEmbedder,
  defaultEmbedCacheDir,
  isEmbedderResolvable,
} from "@fenglimg/fabric-server";

import { paint, displayWidth } from "../colors.js";
import { getProjectTranslator } from "../i18n.js";
import { warnUnknownFlags } from "../lib/unknown-flags.js";
import { whoami, projectStatus } from "../store/info-ops.js";
import { scopeExplain } from "../store/scope-explain.js";
import { grid, groupDot, headerRule } from "../tui/structure.js";

// ---------------------------------------------------------------------------
// EPIC-010 / W3-F: Unified `fabric info` command combining identity/status/scope.
//
// Usage:
//   fabric info               → project status (machine + project + recall health)
//   fabric info --global      → global identity (原 whoami)
//   fabric info --recall       → recall-engine detail (was the `recall` subcommand)
//   fabric info --recall --warm → load/download the embedder model
//   fabric info scope <coord> → scope resolution (real subcommand; 原 scope-explain)
//
// UX-flat follow-up: `recall` was demoted from a citty subCommand to a `--recall`
// flag on `info` — it had no external callers and the goal is a leaner subcommand
// surface (one-line recall health now lives in `fabric info` itself; the flag
// shows the full table). `scope` STAYS a real subcommand because skills depend on
// the `fabric info scope <coord>` JSON data contract (fabric-archive / -review /
// -sync), so it is only de-emphasized in help, never removed.
// ---------------------------------------------------------------------------

const scopeCommand = defineCommand({
  meta: {
    name: "scope",
    // De-emphasized: this is an advanced / skill-facing JSON resolver, not a
    // daily-use surface. Skills call `fabric info scope <coord> --json` to learn
    // a scope's read-set + write target before archiving knowledge.
    description: "(advanced/skill) Resolve a scope coordinate's read-set + write target as JSON",
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
    description: "Unified information command for Fabric identity, project status, and recall health",
  },
  args: {
    global: {
      type: "boolean",
      description: "Show global identity (whoami) instead of project status",
      alias: "g",
    },
    recall: {
      type: "boolean",
      description: "Show recall-engine detail (fusion strategy + embedding state)",
    },
    warm: {
      type: "boolean",
      description: "With --recall: load the embedder now (downloads the model to ~/.fabric/cache/embed on first run)",
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON instead of text",
    },
  },
  subCommands: {
    scope: scopeCommand,
  },
  async run({ args }: { args: { global?: boolean; recall?: boolean; warm?: boolean; json?: boolean; _?: string[] } }) {
    // citty 0.2.2's runCommand falls through to this parent `run` even AFTER it
    // dispatches a matched subcommand (it never returns post-dispatch). Without
    // this guard, `fabric info scope <coord>` prints the project status a second
    // time — and worse, appends it after `scope`'s JSON, breaking that machine
    // contract. When a real subcommand was invoked the parent must stay silent.
    if (isSubCommandInvocation(args._)) {
      return;
    }
    warnUnknownFlags(["global", "g", "recall", "warm", "json"]);
    if (args.recall === true) {
      if (args.warm === true) {
        await runRecallWarm(args.json);
        return;
      }
      runRecallStatus(args.json);
      return;
    }
    if (args.global === true) {
      runWhoami(args.json);
      return;
    }
    runStatus(args.json);
  },
});

// The parent `info` command defines no positional args, so an invoked subcommand
// token lands in citty's `args._` positional rest. `scope` is the only remaining
// subcommand (recall is now a `--recall` flag).
function isSubCommandInvocation(positionals: string[] | undefined): boolean {
  return (positionals ?? [])[0] === "scope";
}

// ---------------------------------------------------------------------------
// Command implementations (ported from original commands)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// flat-design (spec §0.4): `fabric info` is read-only key-value output, so its
// flat form is a command-level B-横线 title (headerRule, blank line above) over an
// aligned label/value grid; list items (mounted stores) render as single
// `● <name>  ✓ <detail>` rows. Colour stays the status layer only (✓ green =
// present/ready, ○ amber = soft "not ready", reserving ✗ red for real errors);
// the teal accent lives solely on the command title (headerRule). The `--json`
// branches above are left untouched — they are the machine contract.
// ---------------------------------------------------------------------------

/** Command-level B-横线 title with a blank line above (renderSection rhythm). */
function infoTitle(title: string): void {
  console.log("");
  console.log(headerRule(title));
}

/** Two-space indent a (possibly multi-line) block, matching the summary body.
 * Trailing whitespace is stripped per line so padded grid cells never leave a
 * ragged right edge. */
function indent2(block: string): string {
  return block
    .split("\n")
    .map((line) => `  ${line}`.replace(/[ \t]+$/, ""))
    .join("\n");
}

/** Aligned label/value grid — labels muted (structural), values carry the info.
 * `indent` controls the left margin (group rows sit one level deeper). */
function kvGrid(rows: Array<[string, string]>, indent = "  "): void {
  const block = grid(
    rows.map(([k, v]) => [paint.muted(k), v]),
    { gap: 3 },
  );
  console.log(
    block
      .split("\n")
      .map((line) => `${indent}${line}`.replace(/[ \t]+$/, ""))
      .join("\n"),
  );
}

/** Group sub-header: a muted `● <label>` dot under the command title (spec §0.4),
 * indented two spaces; its rows nest at four. */
function groupHeader(label: string): void {
  console.log(`  ${groupDot(label)}`);
}

/**
 * A label/value list where any row may carry a `note` — a muted `↳ <note>`
 * continuation line aligned under the value column. Used by the recall detail
 * (install hint / fusion reason) where a flat grid can't express the second line.
 */
interface DetailRow {
  label: string;
  value: string;
  note?: string;
}
function renderDetailRows(rows: DetailRow[], indent = "  "): void {
  const labelW = Math.max(0, ...rows.map((r) => displayWidth(r.label)));
  const lines: string[] = [];
  for (const r of rows) {
    const pad = " ".repeat(Math.max(0, labelW - displayWidth(r.label)) + 3);
    lines.push(`${indent}${paint.muted(r.label)}${pad}${r.value}`.replace(/[ \t]+$/, ""));
    if (r.note) {
      lines.push(`${indent}${" ".repeat(labelW + 3)}${paint.muted(`↳ ${r.note}`)}`);
    }
  }
  console.log(lines.join("\n"));
}

const presentGlyph = (): string => paint.success("✓");
const softGlyph = (): string => paint.warn("○");

/** One-line recall health for the default `fabric info` footer: a status glyph +
 * "semantic search on/off" + a pointer to the detail flag. */
function recallOneLiner(t: ReturnType<typeof getProjectTranslator>): string {
  const status = gatherRecallStatus(process.cwd());
  return status.vector_ready
    ? `${presentGlyph()} ${t("cli.info.recall.summary.on")}`
    : `${softGlyph()} ${t("cli.info.recall.summary.off")}`;
}

function runWhoami(json?: boolean) {
  const info = whoami();
  if (json === true) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  const t = getProjectTranslator();
  infoTitle(t("cli.info.identity.title"));
  if (info === null) {
    console.log(indent2(paint.muted(t("cli.cmd.no-global-config"))));
    return;
  }
  kvGrid([[t("cli.info.field.uid"), info.uid]]);
  if (info.stores.length === 0) {
    console.log(indent2(paint.muted(t("cli.whoami.stores-none"))));
    return;
  }
  // Each mounted store on a single `● <alias>  ✓ <mount_name>  <uuid> (local-only)`
  // row — the friendly name + uuid + local-only caveat folded inline, not a
  // separate side block.
  console.log("");
  const localOnly = t("cli.shared.local-only");
  const rows = info.stores.map((store) => {
    // uuid (only when a friendly mount_name already filled the name column) +
    // the local-only caveat fold into one muted trailing cell.
    const detail = [store.mount_name ? store.store_uuid : "", store.local_only ? localOnly : ""]
      .filter((part) => part.length > 0)
      .join("  ");
    return [
      groupDot(store.alias),
      presentGlyph(),
      store.mount_name ?? store.store_uuid,
      detail ? paint.muted(detail) : "",
    ];
  });
  console.log(indent2(grid(rows, { gap: 2 })));
}

function runStatus(json?: boolean) {
  const status = projectStatus(process.cwd());
  if (json === true) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  const t = getProjectTranslator();
  const none = paint.muted(t("cli.shared.none"));
  infoTitle(t("cli.info.status.title"));

  // Group 1 — THIS MACHINE (global config): identity + every store registered on
  // this computer. This is machine-level, deliberately separated from the
  // project-level binding below so the two stop reading as one confusing list.
  groupHeader(t("cli.info.status.group.machine"));
  kvGrid(
    [
      [t("cli.info.field.uid"), status.uid ?? paint.muted(t("cli.info.status.value.no-global"))],
      [t("cli.info.status.field.mounted"), status.mounted.length > 0 ? status.mounted.join(", ") : none],
    ],
    "    ",
  );

  // Group 2 — CURRENT PROJECT (project config): the id + the store(s) this project
  // is bound to. "required" + "write target" are folded into one "bound stores"
  // line (binding implies the write target); the per-scope write-routes detail is
  // intentionally omitted from the human view — it survives in `--json`.
  console.log("");
  // F9: only call it "not a Fabric project" when there is genuinely no project
  // config. When the project IS initialized but project_id is unset (deferred
  // global-refactor), say "(unset)" instead of lying.
  const projectIdLabel =
    status.project_id ??
    paint.muted(t(status.is_fabric_project ? "cli.info.status.value.unset" : "cli.info.status.value.not-project"));
  groupHeader(t("cli.info.status.group.project"));
  kvGrid(
    [
      [t("cli.info.status.field.project"), projectIdLabel],
      [t("cli.info.status.field.bound"), status.required.length > 0 ? status.required.join(", ") : none],
    ],
    "    ",
  );

  // Footer — one-line recall health, the most common "is semantic search on?"
  // question, with a pointer to `fabric info --recall` for the full table.
  console.log("");
  groupHeader(t("cli.info.recall.title"));
  console.log(`    ${recallOneLiner(t)}`);
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
  // Probe from the SERVER's module base — fastembed is the server's optional
  // dependency and the server is what imports it, so a CLI-anchored check would
  // false-negative in pnpm / dev-linked layouts.
  const fastembedResolvable = isEmbedderResolvable();
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

/**
 * Localized, human reason for `fusion_effective` — synthesized from the STRUCTURED
 * fields rather than translating the freeform `fusion_reason` string (which stays
 * verbatim English in the --json contract). Mirrors gatherRecallStatus's branches.
 */
function localizedFusionReason(
  status: RecallEngineStatus,
  t: ReturnType<typeof getProjectTranslator>,
): string {
  if (status.fusion_configured === "additive") {
    return t("cli.info.recall.reason.forced-additive");
  }
  if (status.fusion_configured === "rrf") {
    return status.vector_ready ? t("cli.info.recall.reason.rrf-ready") : t("cli.info.recall.reason.rrf-warn");
  }
  return status.vector_ready ? t("cli.info.recall.reason.auto-rrf") : t("cli.info.recall.reason.auto-additive");
}

function runRecallStatus(json?: boolean) {
  const status = gatherRecallStatus(process.cwd());
  if (json === true) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  const t = getProjectTranslator();
  infoTitle(t("cli.info.recall.title"));
  // Effective mode shown with a plain-language gloss ("additive(关键词模式)"); the
  // reason is a localized continuation line (the raw English `fusion_reason` lives
  // only in --json). The three readiness rows carry a status glyph (✓ present / ○
  // soft-not-ready) — the one place colour earns its keep here.
  const mode = status.fusion_effective === "rrf" ? t("cli.info.recall.mode.rrf") : t("cli.info.recall.mode.additive");
  const fastembed = status.fastembed_resolvable
    ? `${presentGlyph()} ${t("cli.info.recall.fastembed.yes")}`
    : `${softGlyph()} ${t("cli.info.recall.fastembed.no")}`;
  const cached = status.model_cached
    ? `${presentGlyph()} ${t("cli.shared.yes")}`
    : `${softGlyph()} ${t("cli.info.recall.cached.no")}`;
  const vector = status.vector_ready
    ? `${presentGlyph()} ${t("cli.info.recall.vector.ready")}`
    : `${softGlyph()} ${t("cli.info.recall.vector.not-ready")}`;
  renderDetailRows([
    { label: t("cli.info.recall.field.fusion-config"), value: status.fusion_configured },
    { label: t("cli.info.recall.field.fusion-effective"), value: mode, note: localizedFusionReason(status, t) },
    { label: t("cli.info.recall.field.embed-enabled"), value: status.embed_enabled ? t("cli.shared.yes") : t("cli.shared.no") },
    { label: t("cli.info.recall.field.embed-model"), value: status.embed_model },
    {
      label: t("cli.info.recall.field.fastembed"),
      value: fastembed,
      // Only show the install hint when it is actually missing.
      note: status.fastembed_resolvable ? undefined : t("cli.info.recall.install-hint"),
    },
    { label: t("cli.info.recall.field.cache-dir"), value: paint.muted(status.model_cache_dir) },
    { label: t("cli.info.recall.field.model-cached"), value: cached },
    { label: t("cli.info.recall.field.vector"), value: vector },
  ]);
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
  const t = getProjectTranslator();
  if (ok) {
    console.log(
      `${presentGlyph()} ${t("cli.info.recall.warm.ok", { model: embed.model, dim: String(dim ?? "?"), dir: cacheDir })}`,
    );
  } else {
    console.log(`${paint.error("✗")} ${t("cli.info.recall.warm.fail")}`);
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
