/**
 * ISS-20260713-055: shared deps binder for fab_review write actions.
 */
import type { EventLedgerEventInput } from "@fenglimg/fabric-shared";
import type { KnowledgeType } from "@fenglimg/fabric-shared/schemas/api-contracts";

export type PluralType = KnowledgeType;
export type Layer = "team" | "personal";
export type Maturity = "draft" | "verified" | "proven";
export type RelevanceScope = "narrow" | "broad";
export type LifecycleStatus = "active" | "rejected" | "deferred";

export const PLURAL_TYPES: ReadonlyArray<PluralType> = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
];

export const SCOPE_COORDINATE_PATTERN = /^(?:personal|team|project:[a-z0-9][a-z0-9_-]*)$/u;

export type ReviewWriteDeps = {
  resolveSandboxedPath: (
    projectRoot: string,
    pendingPath: string,
    opts?: { allowPersonal?: boolean },
  ) => { abs: string; isInProjectTree: boolean };
  assertNoSecretsInReviewContent: (content: string, op: string) => void;
  assertCrossStoreRefsSafe: (content: string, entryLayer: "team" | "personal") => void;
  emitKnowledgeLifecycleEvent: (
    projectRoot: string,
    event: EventLedgerEventInput,
  ) => Promise<void>;
  extractBodyTrimmed: (content: string) => string;
  resolvePersonalRoot: () => string;
  storeKnowledgeRoots: (projectRoot: string) => string[];
  isUnder: (abs: string, root: string) => boolean;
  realpathExistingPrefix: (path: string) => string;
};

let deps: ReviewWriteDeps | null = null;

export function bindReviewWriteDeps(d: ReviewWriteDeps): void {
  deps = d;
}

export function D(): ReviewWriteDeps {
  if (!deps) throw new Error("review-write-actions: bindReviewWriteDeps not called");
  return deps;
}
