// v2.1 ③ vector-chinese-model (P3): opt-in "enable semantic search" install step.
//
// Turning on vector recall has three operator-side moving parts:
//   1. install the optional `fastembed` package WHERE THE SERVER RESOLVES MODULES
//      (global MCP install → `npm i -g fastembed`),
//   2. warm the model cache (first run downloads weights; strict-offline pre-warms
//      FABRIC_EMBED_CACHE_DIR),
//   3. flip `embed_enabled` + pin `embed_model` in `.fabric/fabric-config.json`.
//
// This module owns step 3 (idempotent config merge) and renders the operator
// instructions for steps 1+2 (which are network/host actions we never auto-run).
// It is OPT-IN: a normal `fabric init` never touches embed config (the skip path).
//
// Config file: `.fabric/fabric-config.json` — the single project-config source of
// truth (A1, KT-DEC-0003). Both the server runtime (`readEmbedConfig` in
// config-loader) and the hooks/panel read this same file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { t } from "../i18n.js";

// Mirror of config-loader DEFAULT_EMBED_MODEL — the light Chinese model. Kept as
// a local literal so this CLI module has no server-package import just for a
// string (and so the install footprint argument in vector-retrieval holds).
export const DEFAULT_EMBED_MODEL_PIN = "fast-bge-small-zh-v1.5";

export interface EnableSemanticSearchResult {
  configPath: string;
  model: string;
  /** true when embed was already enabled with this exact model (no write needed). */
  alreadyEnabled: boolean;
  /** true when this call wrote the config (created or modified). */
  changed: boolean;
}

/**
 * Idempotently enable vector semantic search by merging `embed_enabled: true` +
 * `embed_model` into `.fabric/fabric-config.json`. Preserves every other key.
 * Re-running with the same model is a no-op (alreadyEnabled, no write).
 */
export function enableSemanticSearch(
  projectRoot: string,
  opts: { model?: string } = {},
): EnableSemanticSearchResult {
  const model = typeof opts.model === "string" && opts.model.length > 0 ? opts.model : DEFAULT_EMBED_MODEL_PIN;
  const configPath = join(projectRoot, ".fabric", "fabric-config.json");

  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt config — treat as empty and overwrite (the merge below re-seeds
      // a valid file rather than leaving the operator with an unparseable one).
      existing = {};
    }
  }

  const alreadyEnabled = existing.embed_enabled === true && existing.embed_model === model;
  if (alreadyEnabled) {
    return { configPath, model, alreadyEnabled: true, changed: false };
  }

  const merged = { ...existing, embed_enabled: true, embed_model: model };
  // Ensure `.fabric/` exists — enableSemanticSearch may run before/independently
  // of the install scaffold on a project whose `.fabric/` dir is not yet present.
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return { configPath, model, alreadyEnabled: false, changed: true };
}

/**
 * grill C-17: read-only check whether vector semantic search is ALREADY enabled,
 * WITHOUT the enable side-effect of enableSemanticSearch. Lets the install prompt
 * detect-first and skip the Yes/No confirm (which used to ask → get "yes" → then
 * anticlimactically report "already enabled, nothing changed").
 */
export function isSemanticSearchEnabled(projectRoot: string): { enabled: boolean; model?: string } {
  const configPath = join(projectRoot, ".fabric", "fabric-config.json");
  if (!existsSync(configPath)) {
    return { enabled: false };
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    if (parsed?.embed_enabled === true) {
      return { enabled: true, model: typeof parsed.embed_model === "string" ? parsed.embed_model : undefined };
    }
  } catch {
    // Corrupt config — treat as not enabled (the enable path re-seeds it).
  }
  return { enabled: false };
}

/**
 * Operator instructions for the host-side steps (install fastembed + warm cache
 * + reindex). Returned as lines so the caller can route them through its logger.
 *
 * C5: routed through `t()` so the copy follows `fabric_language` instead of the
 * old hardcoded-Chinese block. Header carries the pinned model; the remaining
 * lines are the manual fallback steps (used when the interactive offer to run
 * `npm i -g fastembed` is declined or unavailable).
 */
export function renderSemanticSearchInstructions(model: string): string[] {
  return [
    t("cli.install.semantic.enabled", { model }),
    ...t("cli.install.semantic.manual-steps").split("\n"),
  ];
}
