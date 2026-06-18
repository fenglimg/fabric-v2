/**
 * crack 4: deterministic (type, slug) merge of cross-session duplicate pending
 * entries.
 *
 * Two sessions archiving the SAME knowledge produce two pending FILES, because
 * the idempotency key is sha256({source_session, type, slug}) (FROZEN — see
 * extract-knowledge.ts:169-175) so a different `source_session` yields a
 * different key, and the slug auto-disambiguator (extract-knowledge.ts NEW-6)
 * writes session B's entry to `<slug>-N.md` (N ∈ 2..9) when `<slug>.md` is
 * already taken. The review-side semantic dedupe is LLM-only and compares
 * against canonical entries (never pending-vs-pending), so these cross-session
 * twins structurally never collapse.
 *
 * This module collapses them DETERMINISTICALLY — no LLM, no semantic judgement
 * — by recognising the disambiguation CHAIN: a `<base>-N.md` file whose
 * `<base>.md` sibling also exists in the same type dir is, by construction, a
 * slug-collision twin. We group the chain, and when its members span ≥2
 * DISTINCT primary sessions we merge them into one survivor (union
 * `source_sessions`, fold each twin's body in as an Evidence block, delete the
 * rest). The frozen idempotency key is NOT touched — the survivor keeps its own.
 *
 * Honest residual (out of scope, by design): only LITERAL slug collisions are
 * caught. Two windows that give the SAME decision DIFFERENT slugs still produce
 * two unrelated files — that is the semantic-identity judgement core, left to
 * the review-time LLM. We also never strip a trailing `-N` blindly (that would
 * mis-group a legitimate slug like `owasp-top-10`): a `-N` file is only treated
 * as a twin when its base sibling is physically present.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { atomicWriteText, extractBody } from "./_shared.js";
import { resolveStorePendingBase } from "./cross-store-write.js";

// The five canonical pending type subdirs (mirrors PLURAL_TYPES in review.ts).
const PENDING_TYPES = ["decisions", "pitfalls", "guidelines", "models", "processes"] as const;

// Disambiguation suffix the slug auto-disambiguator appends: `-2` .. `-9`.
const DISAMBIGUATION_SUFFIX = /^(.+)-([2-9])\.md$/u;

type PendingTwinMerge = {
  layer: "team" | "personal";
  type: string;
  base_slug: string;
  /** absolute path of the surviving merged entry */
  survivor: string;
  /** absolute paths of the twin files folded in and deleted */
  removed: string[];
  /** union of source_sessions across the merged set (survivor-first order) */
  source_sessions: string[];
};

export type PendingDedupeReport = {
  merged: PendingTwinMerge[];
};

type ParsedPending = {
  name: string;
  abs: string;
  content: string;
  sourceSessions: string[];
  primarySession: string;
  createdAt: string;
};

const SOURCE_SESSIONS_LINE = /^source_sessions:\s*\[(.*)\]\s*$/mu;
const CREATED_AT_LINE = /^created_at:\s*(.+)$/mu;

function parseSourceSessions(content: string): string[] {
  const m = SOURCE_SESSIONS_LINE.exec(content);
  if (!m) return [];
  try {
    const arr = JSON.parse(`[${m[1]}]`);
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function parseCreatedAt(content: string): string {
  const m = CREATED_AT_LINE.exec(content);
  return m ? m[1].trim() : "";
}

/**
 * Resolve a pending filename to its disambiguation BASE. `<base>-N.md` maps to
 * `<base>` ONLY when `<base>.md` is physically present in the same dir (so a
 * standalone `phase-2.md` with no `phase.md` is its own base, not a twin).
 */
function resolveBaseSlug(name: string, present: Set<string>): string {
  const m = DISAMBIGUATION_SUFFIX.exec(name);
  if (m && present.has(`${m[1]}.md`)) return m[1];
  return name.replace(/\.md$/u, "");
}

// Union of source_sessions in survivor-first order, de-duplicated.
function unionSessions(survivor: ParsedPending, twins: ParsedPending[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [survivor, ...twins]) {
    for (const sid of s.sourceSessions) {
      if (sid.length > 0 && !seen.has(sid)) {
        seen.add(sid);
        out.push(sid);
      }
    }
  }
  return out;
}

// Rewrite the survivor's source_sessions frontmatter line to the union and fold
// each twin's body in as a dedicated Evidence block (lossless — the twin's
// content is preserved, never silently dropped).
function buildMergedContent(survivor: ParsedPending, twins: ParsedPending[]): string {
  const union = unionSessions(survivor, twins);
  let merged = survivor.content.replace(
    SOURCE_SESSIONS_LINE,
    `source_sessions: [${union.map((s) => JSON.stringify(s)).join(", ")}]`,
  );
  if (!merged.endsWith("\n")) merged += "\n";
  for (const twin of twins) {
    const body = extractBody(twin.content).trim();
    if (body.length === 0) continue;
    merged += `\n## Evidence (merged from session ${twin.primarySession || "unknown"})\n\n${body}\n`;
  }
  return merged;
}

// Choose the survivor: prefer `<base>.md` (the original, un-suffixed slot), else
// the earliest created_at, tie-broken by filename for determinism.
function chooseSurvivor(baseSlug: string, group: ParsedPending[]): ParsedPending {
  const exact = group.find((p) => p.name === `${baseSlug}.md`);
  if (exact) return exact;
  return [...group].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  })[0];
}

/**
 * Scan the resolved write-target pending stores and deterministically merge
 * cross-session (type, base-slug) twins. Idempotent and best-effort: an
 * unresolvable layer, an unreadable dir, or a malformed file is skipped, never
 * fatal. Returns a report of every merge performed.
 */
export async function mergePendingTwins(projectRoot: string): Promise<PendingDedupeReport> {
  const merged: PendingTwinMerge[] = [];

  for (const layer of ["team", "personal"] as const) {
    let pendingBase: string;
    try {
      pendingBase = resolveStorePendingBase(layer, projectRoot);
    } catch {
      continue; // layer has no resolvable write-target store
    }

    for (const type of PENDING_TYPES) {
      const dir = join(pendingBase, type);
      if (!existsSync(dir)) continue;
      let names: string[];
      try {
        names = (await readdir(dir)).filter((n) => n.endsWith(".md"));
      } catch {
        continue;
      }
      if (names.length < 2) continue;
      const present = new Set(names);

      // Group filenames by disambiguation base.
      const groups = new Map<string, string[]>();
      for (const name of names) {
        const base = resolveBaseSlug(name, present);
        const arr = groups.get(base);
        if (arr) arr.push(name);
        else groups.set(base, [name]);
      }

      for (const [baseSlug, groupNames] of groups) {
        if (groupNames.length < 2) continue;

        const parsed: ParsedPending[] = [];
        for (const name of groupNames) {
          const abs = join(dir, name);
          let content: string;
          try {
            content = await readFile(abs, "utf8");
          } catch {
            continue;
          }
          const sourceSessions = parseSourceSessions(content);
          parsed.push({
            name,
            abs,
            content,
            sourceSessions,
            primarySession: sourceSessions[0] ?? "",
            createdAt: parseCreatedAt(content),
          });
        }
        if (parsed.length < 2) continue;

        // Only merge genuine CROSS-session twins (≥2 distinct primary sessions).
        // Same-session re-disambiguations are left alone — they are distinct
        // knowledge the author deliberately split, not accidental duplicates.
        const distinctPrimaries = new Set(parsed.map((p) => p.primarySession).filter((s) => s.length > 0));
        if (distinctPrimaries.size < 2) continue;

        const survivor = chooseSurvivor(baseSlug, parsed);
        const twins = parsed.filter((p) => p.abs !== survivor.abs);
        const mergedContent = buildMergedContent(survivor, twins);

        try {
          await atomicWriteText(survivor.abs, mergedContent);
          for (const twin of twins) {
            await unlink(twin.abs);
          }
        } catch {
          continue; // partial-failure safety: skip this group, keep going
        }

        merged.push({
          layer,
          type,
          base_slug: baseSlug,
          survivor: survivor.abs,
          removed: twins.map((t) => t.abs),
          source_sessions: unionSessions(survivor, twins),
        });
      }
    }
  }

  return { merged };
}
