/**
 * ISS-20260713-013 first slice: path helpers extracted from review.ts god-module.
 */
import { basename } from "node:path";

export function extractReviewSlug(path: string): string {
  const file = basename(path).replace(/\.md$/u, "");
  return file.replace(/^K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d+--/u, "");
}

/** True when path is under knowledge/pending/ (any store layout). */
export function isPendingKnowledgePath(path: string): boolean {
  return /(?:^|[\\/])knowledge[\\/]pending[\\/]/u.test(path);
}
