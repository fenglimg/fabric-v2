/**
 * ISS-20260713-055: modify-target helpers extracted from review-write-actions.
 */
import { existsSync } from "node:fs";
import type { KnowledgeType } from "@fenglimg/fabric-shared/schemas/api-contracts";
import { extractReviewSlug } from "./review-path.js";
import type { ParsedFrontmatter } from "./review-frontmatter.js";
import { D, PLURAL_TYPES, type PluralType, type Layer, type Maturity, type RelevanceScope } from "./review-write-shared.js";

export type ModifyChanges = {
  title?: string;
  summary?: string;
  layer?: Layer;
  maturity?: Maturity;
  tags?: string[];
  // v2.0-rc.5 C3 (TASK-012): relevance fields editable via modify. Apply to
  // pending AND canonical entries. A narrow team → personal layer flip
  // triggers an auto-degrade override (broad + []) regardless of caller-sent
  // values — see `modifyEntry`.
  relevance_scope?: RelevanceScope;
  relevance_paths?: string[];
  // v2.2 project-scope migration: in-place re-scope of the resolution
  // coordinate (team → project:<id>). visibility_store is untouched —
  // scope ⊥ store. Personal-root coordinates are rejected in modifyEntry.
  semantic_scope?: string;
  // v2.2 graph edges (KT-DEC-0031): `related` H2 adjacency. REPLACE semantics
  // like tags. Previously dropped by zod .strip() in the changes schema before
  // it ever reached here (the only related-write path was non-functional).
  related?: string[];
  // rc.9 (2026-07-06): discovery-signal scalar patches. Same recurrence pattern
  // as `related` above (KT-PIT-0005 / KT-PIT-0018): pre-rc.9 the zod .strip()
  // silently dropped these three, so the only path to fix a bad-shape
  // must_read_if / missing intent_clues was direct Edit — bypassing the skill
  // audit trail. REPLACE semantics; must_read_if is a scalar string; the other
  // two are flow-arrays mirroring tags/related.
  must_read_if?: string;
  intent_clues?: string[];
  impact?: string[];
  // ISS-20260711-180: keep in lockstep with _fabReviewModifyChangesSchema.
  tech_stack?: string[];
  evidence_paths?: string[];
  onboard_slot?:
    | "tech-stack-decision"
    | "architecture-pattern"
    | "code-style-tone"
    | "build-system-idiom"
    | "domain-vocabulary";
};



export type ResolvedTarget = {
  absPath: string;
  // Whether the target lives under the project's git tree (team or pending)
  // or under FABRIC_HOME (personal canonical).
  isInProjectTree: boolean;
  // Plural type (parsed from path segment if available); null for pending
  // files where the directory is `pending/<type>/` — caller can derive.
  inferredType: PluralType | null;
  // Slug (filename without .md, with id prefix stripped if present).
  slug: string;
};

export function pickModifyEventValues(
  source: Partial<ParsedFrontmatter & ModifyChanges>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field] = source[field as keyof (ParsedFrontmatter & ModifyChanges)] ?? null;
  }
  return out;
}

export function resolveModifyTarget(
  projectRoot: string,
  pendingPath: string,
): ResolvedTarget | null {
  // Defense-in-depth: constrain caller-supplied path to the resolved store
  // knowledge roots. Reject traversal attempts. modify accepts both pending and
  // canonical store entries.
  let sandboxed: { abs: string; isInProjectTree: boolean };
  try {
    sandboxed = D().resolveSandboxedPath(projectRoot, pendingPath, { allowPersonal: true });
  } catch {
    return null;
  }

  if (existsSync(sandboxed.abs)) {
    return {
      absPath: sandboxed.abs,
      isInProjectTree: sandboxed.isInProjectTree,
      inferredType: inferTypeFromPath(pendingPath),
      slug: extractSlug(pendingPath),
    };
  }

  return null;
}

export function inferTypeFromPath(path: string): PluralType | null {
  // Match `<...>/knowledge/[pending/]<type>/<file>.md`.
  const match = /(?:^|[\\/])knowledge[\\/](?:pending[\\/])?([^\\/]+)[\\/][^\\/]+\.md$/u.exec(path);
  if (match === null) return null;
  const seg = match[1];
  if (seg !== undefined && PLURAL_TYPES.includes(seg as PluralType)) {
    return seg as PluralType;
  }
  return null;
}

export function extractSlug(path: string): string {
  return extractReviewSlug(path);
}

// test hook lives in review.ts facade re-exporting review-path

