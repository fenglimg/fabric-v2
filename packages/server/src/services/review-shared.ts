/**
 * ISS-20260713-013: shared path/sandbox/list/event helpers for review facade.
 */
import { existsSync, realpathSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { EventLedgerEventInput } from "@fenglimg/fabric-shared";
import type { KnowledgeType } from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  aggregatePendingAcrossStores,
  hasSecrets,
  lintCrossStoreReferences,
  type MountedStoreDir,
  readStoreIdentityAsync,
} from "@fenglimg/fabric-shared";
import {
  resolveStoreCanonicalBase,
  resolveStorePendingBase,
  resolveWriteTargetStoreDir,
} from "./cross-store-write.js";
import { extractBody } from "./_shared.js";
import { parseFrontmatter, type ParsedFrontmatter } from "./review-frontmatter.js";
import { mergePendingTwins } from "./pending-dedupe.js";
import { appendEventLedgerEvent } from "./event-ledger.js";

type PluralType = KnowledgeType;
export type Layer = "team" | "personal";
type Maturity = "draft" | "verified" | "proven";
type RelevanceScope = "narrow" | "broad";
type LifecycleStatus = "active" | "rejected" | "deferred";

export const PLURAL_TYPES: ReadonlyArray<PluralType> = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];

const SCOPE_COORDINATE_PATTERN = /^(?:personal|team|project:[a-z0-9][a-z0-9_-]*)$/u;

export function storeKnowledgeRoots(projectRoot: string): string[] {
  const roots: string[] = [];
  for (const layer of ["team", "personal"] as const) {
    try {
      roots.push(resolve(resolveStoreCanonicalBase(layer, projectRoot)));
    } catch {
      // layer has no resolvable write-target store — not a whitelist entry.
    }
  }
  return roots;
}

// ISS-20260711-147: resolve through realpath so a symlink under an admitted
// store root cannot escape to a non-store location (isUnder on lexical paths
// alone is insufficient when the leaf or an intermediate component is a link).
export function realpathExistingPrefix(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // File may not exist yet (approve writes a new canonical path). Resolve the
    // deepest existing ancestor and rejoin the missing suffix.
    let cursor = path;
    const missing: string[] = [];
    while (cursor !== dirname(cursor)) {
      missing.unshift(basename(cursor));
      cursor = dirname(cursor);
      try {
        return missing.reduce((acc, part) => join(acc, part), realpathSync(cursor));
      } catch {
        // keep walking up
      }
    }
    return path;
  }
}

export function isUnder(abs: string, root: string): boolean {
  const absReal = realpathExistingPrefix(abs);
  const rootReal = realpathExistingPrefix(root);
  const rel = relative(rootReal, absReal);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertNoSecretsInReviewContent(content: string, op: string): void {
  // ISS-20260711-144 / 145: review write paths previously bypassed the extract-
  // time hasSecrets gate, so approve/modify/reject could land credential-shaped
  // text into store git. Fail closed before any disk write.
  if (hasSecrets(content)) {
    throw new Error(
      `${op} blocked: content matches a credential/secret pattern — refuse to write secrets into knowledge store`,
    );
  }
}

export function extractHardGlobalRefs(content: string): string[] {
  // Conservative: store-qualified stable ids + wiki-style [[store:ID]] / bare refs.
  const refs = new Set<string>();
  const re = /\b(?:team|personal|store):[A-Z]{2}-[A-Z]{3}-\d{4}\b|\[\[([^\]]+)\]\]/gu;
  for (const match of content.matchAll(re)) {
    const full = match[0];
    if (full.startsWith("[[")) {
      const inner = (match[1] ?? "").trim();
      if (inner.length > 0) refs.add(inner);
    } else {
      refs.add(full);
    }
  }
  return [...refs];
}

export function assertCrossStoreRefsSafe(content: string, entryLayer: "team" | "personal"): void {
  // ISS-20260711-178: shared-layer writes must not hard-ref personal knowledge.
  if (entryLayer !== "team") return;
  const referencedGlobalRefs = extractHardGlobalRefs(content);
  if (referencedGlobalRefs.length === 0) return;
  // Literal personal-layer cites are an immediate violation in shared content
  // (store_uuid map may be incomplete on this hot path; personal: prefix is enough).
  const personalCites = referencedGlobalRefs.filter((r) => r.startsWith("personal:") || r.startsWith("KP-"));
  if (personalCites.length > 0) {
    throw new Error(
      `write blocked: shared-store entry references personal knowledge (${personalCites.join(", ")})`,
    );
  }
  // Also run the structured lint when refs look store-qualified (uuid form).
  const storeVisibility: Record<string, "shared" | "personal"> = {};
  const violations = lintCrossStoreReferences({
    entryVisibility: "shared",
    referencedGlobalRefs,
    storeVisibility,
  });
  if (violations.length > 0) {
    throw new Error(
      `write blocked: shared-store entry references personal knowledge (${violations.map((v) => v.ref).join(", ")})`,
    );
  }
}

export function resolveSandboxedPath(
  projectRoot: string,
  candidate: string,
  options: { allowPersonal?: boolean } = {},
): { abs: string; isInProjectTree: boolean } {
  if (candidate.length === 0) {
    throw new Error("path is empty");
  }

  // Defense-in-depth: only the EXACT store knowledge roots the resolver returns
  // for this project are admitted (never an arbitrary store path).
  const storeRoots = storeKnowledgeRoots(projectRoot);

  // Retired non-store personal roots are not valid knowledge targets anymore.
  // Store paths should be passed as absolute paths returned by list/search, or
  // resolved through the exact store roots above.
  if (candidate.startsWith("~/")) {
    throw new Error(`legacy personal knowledge root is retired; use a store path: ${candidate}`);
  }

  // Absolute paths are admitted ONLY when they resolve under a resolved store
  // knowledge root (the form listPending reports for store-routed entries).
  // Store entries live outside the project's git tree (each store is its own
  // repo), so isInProjectTree is false.
  if (isAbsolute(candidate)) {
    const abs = resolve(candidate);
    if (storeRoots.some((root) => isUnder(abs, root))) {
      return { abs, isInProjectTree: false };
    }
    throw new Error(`path escapes store knowledge root: ${candidate}`);
  }

  // Project-relative legacy non-store paths are retired. Only admit a relative
  // path if it happens to resolve under one of this project's resolved store
  // roots (normally callers pass absolute store paths from list/search).
  const projectAbs = resolve(projectRoot, candidate);
  if (storeRoots.some((root) => isUnder(projectAbs, root))) {
    return { abs: projectAbs, isInProjectTree: false };
  }

  throw new Error(`path escapes store knowledge root: ${candidate}`);
}

// ---------------------------------------------------------------------------
// list action
// ---------------------------------------------------------------------------

export type ListFilters = {
  type?: PluralType;
  layer?: "team" | "personal" | "both";
  maturity?: Maturity;
  tags?: string[];
  // rc.4 TASK-006 fix (c): ISO-8601 lower bound on entry created_at. Entries
  // strictly older than this threshold are excluded. Applied to both list and
  // search actions for symmetry. Comparison is lexicographic on the ISO-8601
  // string, which is correct for fully-qualified UTC timestamps with
  // identical zone suffix (Z) — the contract layer enforces datetime() format.
  created_after?: string;
  // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): opt-in surfacing of lifecycle-filtered
  // entries. Default behavior hides rejected (always) and deferred (when the
  // deferred_until threshold is still in the future). Callers that need the
  // full pending population — vacuum tooling, audit dashboards — pass these
  // overrides explicitly.
  include_rejected?: boolean;
  include_deferred?: boolean;
  // v2.0.0-rc.27 TASK-006 (audit §2.23): opt-in body inspection. When true,
  // list/search attach the full post-frontmatter body to each item; search
  // additionally extends the query haystack to body text. Default-off
  // (keeps the wire payload small).
  include_body?: boolean;
};

/**
 * v2.0.0-rc.27 TASK-006 (audit §2.23): extract everything AFTER the closing
 * `---` of frontmatter. Used by list/search when filters.include_body=true
 * to surface the body content for reviewer inspection — the prompt-injection
 * mitigation surface (a malicious payload hiding under `## Evidence` is
 * invisible to frontmatter-only views).
 *
 * Returns the trimmed body; if no frontmatter is present, returns the
 * full content as body (defensive — a malformed entry without `---`
 * fences shouldn't be silently dropped from the body inspection surface).
 */
// ISS-017: body extraction now uses the single shared extractBody (_shared.ts).
// review trims for its list/search inspection surface, so this wrapper applies
// `.trim()` explicitly \u2014 keeping the trim policy visible at the consumer.
export function extractBodyTrimmed(content: string): string {
  return extractBody(content).trim();
}

export type ListItem = {
  pending_path: string;
  // v2.0.0-rc.27 TASK-001 (§2.12): only emitted for personal-layer entries.
  // Team entries use project-relative paths in `pending_path` which are
  // already programmatically consumable without expansion.
  pending_path_absolute?: string;
  type: PluralType;
  layer: Layer;
  maturity: Maturity;
  tags?: string[];
  // ISS-20260712-011: triage UI needs title/summary without an extra body Read.
  title?: string;
  summary?: string;
  proposed_reason?: string;
  // origin indicates which write-target store root the entry came from.
  // Both layers now resolve to mounted store knowledge/pending/ trees.
  origin?: "team" | "personal";
  // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): lifecycle status surfaced when present
  // in the frontmatter. Listings filter on this by default (see
  // applyLifecycleFilter); the field is also surfaced so callers can pivot
  // their own UI on it (e.g. show a "deferred" badge).
  status?: LifecycleStatus;
  deferred_until?: string;
  // v2.0.0-rc.27 TASK-006 (audit §2.23): full body content (everything
  // after the closing `---` of frontmatter). Surfaced only when the
  // caller passed `filters.include_body: true`.
  body?: string;
};

// v2.0.0-rc.29 TASK-007 (BUG-M4): search result item. Search ranges over both
// pending and canonical entries, so the misleading `pending_path` field (used
// by `list` for pending-only results) is renamed to a neutral `path` and a
// required `area` discriminator is added so consumers can tell the two apart
// without parsing the directory prefix out of the path string.
type SearchItem = {
  area: "pending" | "canonical";
  path: string;
  // `path_absolute` mirrors `ListItem.pending_path_absolute`: emitted only for
  // personal-layer entries where the `path` carries the `~/...` shell-only form.
  path_absolute?: string;
  type: PluralType;
  layer: Layer;
  maturity: Maturity;
  tags?: string[];
  title?: string;
  summary?: string;
  origin?: "team" | "personal";
  status?: LifecycleStatus;
  deferred_until?: string;
  body?: string;
  stable_id?: string;
};

/**
 * v2.0.0-rc.27 TASK-001 (§2.2/§2.3): default visibility filter for list/search.
 * Returns true if the entry should be SHOWN given the caller's filter request.
 *
 * Defaults (when filters absent):
 *   - status="rejected"   → hide (audit only via doctor/event-ledger)
 *   - status="deferred"   → hide IFF deferred_until is absent OR > now
 *   - status="active" / absent → show
 *
 * Callers can pass include_rejected / include_deferred to override. The
 * include_deferred override surfaces deferred entries regardless of their
 * deferred_until threshold (useful for "show me what I've parked" workflows).
 */
export function isVisibleByLifecycle(
  fm: ParsedFrontmatter,
  filters: ListFilters | undefined,
): boolean {
  if (fm.status === "rejected" && filters?.include_rejected !== true) {
    return false;
  }
  if (fm.status === "deferred" && filters?.include_deferred !== true) {
    // No deferred_until → indefinite defer, stay hidden until override.
    // deferred_until in the past → defer expired, surface again.
    if (fm.deferred_until === undefined) return false;
    if (fm.deferred_until > new Date().toISOString()) return false;
  }
  return true;
}



/** ISS-20260711-170: resolve write-target stores as MountedStoreDir for aggregatePendingAcrossStores. */
export async function resolveWriteTargetMountedDirs(projectRoot: string): Promise<MountedStoreDir[]> {
  const out: MountedStoreDir[] = [];
  for (const layer of ["team", "personal"] as const) {
    try {
      const dir = resolveWriteTargetStoreDir(layer, projectRoot);
      const identity = await readStoreIdentityAsync(dir);
      out.push({
        store_uuid: identity?.store_uuid ?? dir,
        alias: identity?.canonical_alias ?? layer,
        dir,
      });
    } catch {
      // layer has no resolvable write-target — skip
    }
  }
  return out;
}

export async function listPending(
  projectRoot: string,
  filters: ListFilters | undefined,
): Promise<ListItem[]> {
  // crack 4: deterministic pre-pass — collapse cross-session (type, slug) twins
  // BEFORE enumerating, so the reviewer never sees a duplicate pair that only
  // exists because two sessions archived the same knowledge under different
  // idempotency keys. Best-effort: a merge failure must never break the list.
  try {
    await mergePendingTwins(projectRoot);
  } catch {
    // never let the self-healing pre-pass break a read
  }

  const items: ListItem[] = [];

  const typesToScan = filters?.type !== undefined ? [filters.type] : PLURAL_TYPES;

  // ISS-20260711-170: primary discovery via aggregatePendingAcrossStores so the
  // multi-store API has a real production consumer. include_rejected still walks
  // the sibling rejected/ tree (aggregate is pending-only).
  const mounted = await resolveWriteTargetMountedDirs(projectRoot);
  const aggregated = mounted.length > 0 ? await aggregatePendingAcrossStores(mounted) : [];
  const discovered: Array<{ absolutePath: string; origin: "team" | "personal"; type: PluralType }> = [];
  for (const ref of aggregated) {
    // Production: pending/<type>/file.md; flat/legacy: pending/file.md
    const parent = basename(dirname(ref.file));
    let type: PluralType | null = null;
    if ((PLURAL_TYPES as readonly string[]).includes(parent)) {
      type = parent as PluralType;
    } else if (parent === "pending") {
      // Flat pending root — no type bucket; only surface when no type filter.
      if (filters?.type !== undefined) continue;
      type = "decisions"; // placeholder bucket for list item shape
    }
    if (type === null) continue;
    if (!typesToScan.includes(type)) continue;
    const origin: "team" | "personal" =
      ref.alias === "personal" || /[/\\]personal[/\\]/u.test(ref.file) ? "personal" : "team";
    discovered.push({ absolutePath: ref.file, origin, type });
  }
  if (filters?.include_rejected === true) {
    for (const origin of ["team", "personal"] as const) {
      try {
        const pendingRoot = resolveStorePendingBase(origin, projectRoot);
        const rejectedRoot = pendingRoot.replace(`${sep}pending`, `${sep}rejected`);
        for (const type of typesToScan) {
          const dir = join(rejectedRoot, type);
          if (!existsSync(dir)) continue;
          let entries: string[];
          try {
            entries = await readdir(dir);
          } catch {
            continue;
          }
          for (const name of entries) {
            if (!name.endsWith(".md")) continue;
            discovered.push({ absolutePath: join(dir, name), origin, type });
          }
        }
      } catch {
        // skip unresolved layer
      }
    }
  }

  for (const source of discovered) {
    const absolutePath = source.absolutePath;
    const origin = source.origin;
    const type = source.type;
    let content: string;
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content);
    // Frontmatter `layer` declares the *destination* classification. For
    // entries living under the personal pending root, default to
    // "personal" when frontmatter omits the field; otherwise default to
    // "team" (mirrors pre-B1 behavior).
    const layer = fm.layer ?? (origin === "personal" ? "personal" : "team");
    const maturity = fm.maturity ?? "draft";

    // Apply filters (best-effort — missing frontmatter values fall back to defaults)
    if (filters?.layer !== undefined && filters.layer !== "both" && filters.layer !== layer) {
      continue;
    }
    if (filters?.maturity !== undefined && filters.maturity !== maturity) {
      continue;
    }
    if (filters?.tags !== undefined && filters.tags.length > 0) {
      const itemTags = fm.tags ?? [];
      const hasAll = filters.tags.every((t) => itemTags.includes(t));
      if (!hasAll) continue;
    }
    // rc.4 TASK-006 fix (c): created_after threshold. Entries lacking
    // created_at frontmatter are conservatively excluded when the filter
    // is set (caller asked for a date window — undated entries cannot be
    // proven to fall inside it).
    if (filters?.created_after !== undefined) {
      const createdAt = fm.created_at;
      if (createdAt === undefined || createdAt < filters.created_after) {
        continue;
      }
    }

    // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): hide rejected/deferred entries
    // by default. See isVisibleByLifecycle for the precise rules.
    if (!isVisibleByLifecycle(fm, filters)) {
      continue;
    }

    // Store-rooted entries (any layer) live outside both the project tree
    // and the personal ~/.fabric root, so they are reported by absolute path.
    const reportedPath = absolutePath;

    items.push({
      pending_path: reportedPath,
      type,
      layer,
      maturity,
      origin: origin,
      ...(typeof fm.title === "string" && fm.title.length > 0 ? { title: fm.title } : {}),
      ...(typeof fm.summary === "string" && fm.summary.length > 0 ? { summary: fm.summary } : {}),
      ...(typeof fm.proposed_reason === "string" && fm.proposed_reason.length > 0
        ? { proposed_reason: fm.proposed_reason }
        : {}),
      ...(fm.tags !== undefined && fm.tags.length > 0 ? { tags: fm.tags } : {}),
      ...(fm.status !== undefined ? { status: fm.status } : {}),
      ...(fm.deferred_until !== undefined ? { deferred_until: fm.deferred_until } : {}),
      // v2.0.0-rc.27 TASK-006 (audit §2.23): full body when caller
      // opted in. Reviewer UI consumes this to scan for prompt-injection
      // payloads hidden under `## Evidence` body.
      ...(filters?.include_body === true ? { body: extractBodyTrimmed(content) } : {}),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// approve action
// ---------------------------------------------------------------------------

export function resolvePersonalRoot(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

// ---------------------------------------------------------------------------
// event emission helper (mirrors extract-knowledge.ts:231-241 best-effort
// observability — pending/canonical files are the source of truth, events
// are observability)
// ---------------------------------------------------------------------------

export async function emitEventBestEffort(
  projectRoot: string,
  event: EventLedgerEventInput,
): Promise<void> {
  try {
    await appendEventLedgerEvent(projectRoot, event);
  } catch {
    // Event emission is observability-only.
  }
}

/** Regulated knowledge mutation audit (ISS-20260711-131).
 * Unlike emitEventBestEffort, ledger failure fails the mutation so disk
 * changes never succeed without a durable audit row. Callers that already
 * wrote files must roll back or surface the error to the operator.
 */
export async function emitAuditEventRequired(
  projectRoot: string,
  event: EventLedgerEventInput,
): Promise<void> {
  await appendEventLedgerEvent(projectRoot, event);
}

const REGULATED_KNOWLEDGE_EVENT_TYPES = new Set([
  "knowledge_promoted",
  "knowledge_promote_failed",
  "knowledge_modified",
  "knowledge_rejected",
  "knowledge_deferred",
  "knowledge_layer_changed",
  "knowledge_demoted",
  "knowledge_archived",
  "knowledge_unarchived",
]);

export async function emitKnowledgeLifecycleEvent(
  projectRoot: string,
  event: EventLedgerEventInput,
): Promise<void> {
  if (REGULATED_KNOWLEDGE_EVENT_TYPES.has(event.event_type)) {
    await emitAuditEventRequired(projectRoot, event);
    return;
  }
  await emitEventBestEffort(projectRoot, event);
}

// ISS-20260713-013: wire search module deps (breaks circular init issues).

