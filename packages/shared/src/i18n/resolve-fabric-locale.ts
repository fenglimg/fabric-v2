import { resolveGlobalLocale } from "./resolve-global-locale.js";
import type { Locale } from "./types.js";

/**
 * Resolve the effective runtime locale for a project-scoped command.
 *
 * grill-6fixes (D1): language is now a SINGLE machine-wide base tone held in
 * `~/.fabric/fabric-global.json` → `language`. The old per-project
 * `fabric_language` field and the README/docs content-detection path were
 * removed, so the `projectRoot` argument is no longer consulted — it is kept
 * only so the existing call sites need no signature change. Everything now
 * delegates to {@link resolveGlobalLocale} (global language → env fallback).
 *
 * Never throws.
 */
export function resolveFabricLocale(_projectRoot?: string): Locale {
  return resolveGlobalLocale();
}
