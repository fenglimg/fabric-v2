// ISS-20260531-003 / 037 (W8 first extract): knowledge hygiene inspections
// extracted from doctor.ts so the godfile can shrink without behavior change.
// Consumers: runDoctorReport (draft backlog + empty tags ratios).

export type DraftBacklogInspection = {
  status: "ok" | "warn";
  draftCount: number;
  totalCount: number;
  ratio: number;
};

export type EmptyTagsInspection = {
  status: "ok" | "warn";
  emptyCount: number;
  totalCount: number;
  ratio: number;
};

const DRAFT_BACKLOG_RATIO = 0.5;
const DRAFT_BACKLOG_MIN_TOTAL = 10;
const EMPTY_TAGS_RATIO = 0.5;
const EMPTY_TAGS_MIN_TOTAL = 10;

type CanonicalLike = {
  description?: {
    maturity?: string;
    tags?: string[];
  };
};

export function inspectDraftBacklogFromCanonical(
  entries: readonly CanonicalLike[],
): DraftBacklogInspection {
  const totalCount = entries.length;
  if (totalCount < DRAFT_BACKLOG_MIN_TOTAL) {
    return { status: "ok", draftCount: 0, totalCount, ratio: 0 };
  }
  let draftCount = 0;
  for (const e of entries) {
    if ((e.description?.maturity ?? "draft") === "draft") draftCount += 1;
  }
  const ratio = draftCount / totalCount;
  return {
    status: ratio > DRAFT_BACKLOG_RATIO ? "warn" : "ok",
    draftCount,
    totalCount,
    ratio,
  };
}

export function inspectEmptyTagsFromCanonical(
  entries: readonly CanonicalLike[],
): EmptyTagsInspection {
  const totalCount = entries.length;
  if (totalCount < EMPTY_TAGS_MIN_TOTAL) {
    return { status: "ok", emptyCount: 0, totalCount, ratio: 0 };
  }
  let emptyCount = 0;
  for (const e of entries) {
    const tags = e.description?.tags;
    if (!Array.isArray(tags) || tags.length === 0) emptyCount += 1;
  }
  const ratio = emptyCount / totalCount;
  return {
    status: ratio > EMPTY_TAGS_RATIO ? "warn" : "ok",
    emptyCount,
    totalCount,
    ratio,
  };
}
