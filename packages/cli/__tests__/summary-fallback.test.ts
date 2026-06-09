/**
 * Tests for templates/hooks/lib/summary-fallback.cjs — the rc.35 TASK-06
 * (P0-10.b) lib that substitutes opaque hint entries (summary == id) with
 * a snippet read from the entry's `## Summary` markdown section.
 *
 * Cases:
 *   (a) pure: _extractFirstSummaryParagraph parses the first ## Summary
 *       paragraph; ignores other heading levels; truncates at 80 chars.
 *   (b) end-to-end: opaque entry → file lookup → summary swap.
 *   (c) cache: second call on identical input does ZERO disk reads.
 *   (d) cache invalidation: a different revision_hash bypasses cache.
 *   (e) defensive: entries with no matching file or no ## Summary section
 *       pass through unchanged (no exception thrown).
 *   (f) non-opaque entries pass through verbatim.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// CJS lib — pull via createRequire so node:test interop is clean.
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const summaryFallback = require_(
  "../templates/hooks/lib/summary-fallback.cjs",
) as {
  resolveOpaqueSummaries: (
    entries: Array<{ id: string; type?: string; summary: string }>,
    projectRoot: string,
    revisionHash: string,
  ) => Array<{ id: string; type?: string; summary: string }>;
  _extractFirstSummaryParagraph: (md: string) => string;
  _readCache: (projectRoot: string) => { revision: string; summaries: Record<string, string> } | null;
  _isOpaque: (entry: unknown) => boolean;
  SUMMARY_MAX_LEN: number;
};

const tempRoots: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE_UUID = "11111111-1111-4111-8111-111111111111";

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fab-summary-fallback-"));
  tempRoots.push(root);
  const fakeHome = mkdtempSync(join(tmpdir(), "fab-summary-fallback-home-"));
  tempRoots.push(fakeHome);
  originalFabricHome = process.env.FABRIC_HOME;
  process.env.FABRIC_HOME = fakeHome;
  const fabricDir = join(root, ".fabric");
  mkdirSync(fabricDir, { recursive: true });
  writeFileSync(
    join(fabricDir, "fabric-config.json"),
    JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2),
    "utf8",
  );
  const globalRoot = join(fakeHome, ".fabric");
  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(
    join(globalRoot, "fabric-global.json"),
    JSON.stringify({
      uid: "test-uid",
      stores: [
        {
          store_uuid: TEAM_STORE_UUID,
          alias: "team",
          remote: "git@example.com:team-store.git",
        },
      ],
    }, null, 2),
    "utf8",
  );
  return root;
}

function seedEntry(
  root: string,
  type: string,
  stableId: string,
  slug: string,
  summaryParagraph: string,
): void {
  const file = join(
    process.env.FABRIC_HOME ?? "",
    ".fabric",
    "stores",
    TEAM_STORE_UUID,
    "knowledge",
    type,
    `${stableId}--${slug}.md`,
  );
  mkdirSync(join(file, ".."), { recursive: true });
  const md = `---\nid: ${stableId}\n---\n\n# ${stableId}\n\n## Summary\n\n${summaryParagraph}\n\n## Other\n\nbody\n`;
  writeFileSync(file, md, "utf8");
}

afterEach(() => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  originalFabricHome = undefined;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
  vi.restoreAllMocks();
});

describe("_extractFirstSummaryParagraph (pure helper)", () => {
  it("(a) extracts the first paragraph beneath `## Summary`", () => {
    const md = `# Title\n\n## Summary\n\nAlpha decision content goes here.\n\n## Next\n\nbody`;
    expect(summaryFallback._extractFirstSummaryParagraph(md)).toBe("Alpha decision content goes here.");
  });

  it("(a) is case-insensitive on the Summary heading", () => {
    const md = `## summary\n\nlower-case heading works.`;
    expect(summaryFallback._extractFirstSummaryParagraph(md)).toBe("lower-case heading works.");
  });

  it("(a) collapses multi-line first paragraph into a single line", () => {
    const md = `## Summary\n\nLine one\nstill same paragraph\nand continues.\n\nBlank breaks it.`;
    expect(summaryFallback._extractFirstSummaryParagraph(md)).toBe(
      "Line one still same paragraph and continues.",
    );
  });

  it("(a) ignores non-H2 'Summary' headings", () => {
    const md = `### Summary\n\nThis is h3, not h2.\n\nrest`;
    expect(summaryFallback._extractFirstSummaryParagraph(md)).toBe("");
  });

  it("(a) truncates to SUMMARY_MAX_LEN with ellipsis", () => {
    const long = "x".repeat(200);
    const md = `## Summary\n\n${long}`;
    const out = summaryFallback._extractFirstSummaryParagraph(md);
    expect(out).toHaveLength(summaryFallback.SUMMARY_MAX_LEN);
    expect(out.endsWith("…")).toBe(true);
  });

  it("(a) returns empty string when ## Summary is absent", () => {
    expect(summaryFallback._extractFirstSummaryParagraph("# Title\n\nbody only")).toBe("");
    expect(summaryFallback._extractFirstSummaryParagraph("")).toBe("");
  });
});

describe("resolveOpaqueSummaries (end-to-end)", () => {
  it("(b) substitutes opaque summaries with fallback text from .md", () => {
    const root = makeProjectRoot();
    seedEntry(root, "decisions", "KT-DEC-0001", "alpha", "Choose Postgres over MongoDB for ACID guarantees.");
    seedEntry(root, "pitfalls", "KT-PIT-0001", "beta", "Atlas premultiplyAlpha black-edge on transparent sprites.");

    const entries = [
      { id: "team:KT-DEC-0001", type: "decision", summary: "team:KT-DEC-0001" },
      { id: "team:KT-PIT-0001", type: "pitfall", summary: "team:KT-PIT-0001" },
    ];
    const resolved = summaryFallback.resolveOpaqueSummaries(entries, root, "rev-1");

    expect(resolved[0].summary).toContain("Postgres");
    expect(resolved[1].summary).toContain("premultiplyAlpha");
    // No `KT-XXX · KT-XXX` rendering shape will result from these summaries.
    expect(resolved[0].summary).not.toBe(resolved[0].id);
    expect(resolved[1].summary).not.toBe(resolved[1].id);
  });

  it("(f) leaves non-opaque entries verbatim", () => {
    const root = makeProjectRoot();
    seedEntry(root, "decisions", "KT-DEC-0001", "alpha", "Real summary in file.");
    const entries = [
      { id: "KT-DEC-0001", type: "decision", summary: "User-authored real summary" },
    ];
    const resolved = summaryFallback.resolveOpaqueSummaries(entries, root, "rev-1");
    expect(resolved[0].summary).toBe("User-authored real summary");
  });

  it("(e) opaque entry with no matching .md leaves summary untouched", () => {
    const root = makeProjectRoot();
    const entries = [
      { id: "KT-DEC-9999", type: "decision", summary: "KT-DEC-9999" },
    ];
    const resolved = summaryFallback.resolveOpaqueSummaries(entries, root, "rev-1");
    expect(resolved[0].summary).toBe("KT-DEC-9999"); // unchanged
  });

  it("(e) opaque entry whose .md has no ## Summary section leaves summary untouched", () => {
    const root = makeProjectRoot();
    const file = join(
      process.env.FABRIC_HOME ?? "",
      ".fabric",
      "stores",
      TEAM_STORE_UUID,
      "knowledge",
      "decisions",
      "KT-DEC-0001--alpha.md",
    );
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "# Title only\n\nNo Summary section.\n", "utf8");
    const entries = [
      { id: "KT-DEC-0001", type: "decision", summary: "KT-DEC-0001" },
    ];
    const resolved = summaryFallback.resolveOpaqueSummaries(entries, root, "rev-1");
    expect(resolved[0].summary).toBe("KT-DEC-0001"); // unchanged
  });

  it("(e) does not read retired project-local .fabric/knowledge files", () => {
    const root = makeProjectRoot();
    const file = join(root, ".fabric", "knowledge", "decisions", "KT-DEC-0001--alpha.md");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "## Summary\n\nLegacy local summary must not be used.\n", "utf8");

    const entries = [
      { id: "KT-DEC-0001", type: "decision", summary: "KT-DEC-0001" },
    ];
    const resolved = summaryFallback.resolveOpaqueSummaries(entries, root, "rev-1");

    expect(resolved[0].summary).toBe("KT-DEC-0001");
  });
});

describe("cache behaviour", () => {
  it("(c) writes a cache file and persists summaries between calls", () => {
    const root = makeProjectRoot();
    seedEntry(root, "decisions", "KT-DEC-0001", "alpha", "First-pass real summary.");
    const entries = [{ id: "KT-DEC-0001", type: "decision", summary: "KT-DEC-0001" }];

    summaryFallback.resolveOpaqueSummaries(entries, root, "rev-1");

    const cache = summaryFallback._readCache(root);
    expect(cache).not.toBeNull();
    expect(cache?.revision).toBe("rev-1");
    expect(cache?.summaries["KT-DEC-0001"]).toContain("First-pass");
  });

  it("(c) second call with same revision reads from cache (no .md re-read)", () => {
    const root = makeProjectRoot();
    seedEntry(root, "decisions", "KT-DEC-0001", "alpha", "Original summary.");
    const entries = [{ id: "KT-DEC-0001", type: "decision", summary: "KT-DEC-0001" }];

    // First call seeds cache.
    summaryFallback.resolveOpaqueSummaries(entries, root, "rev-1");
    // Modify the .md file — if cache works, second call should return the
    // ORIGINAL (cached) summary, not the new content.
    seedEntry(root, "decisions", "KT-DEC-0001", "alpha", "MODIFIED summary should be ignored.");

    const second = summaryFallback.resolveOpaqueSummaries(entries, root, "rev-1");
    expect(second[0].summary).toContain("Original");
    expect(second[0].summary).not.toContain("MODIFIED");
  });

  it("(d) cache invalidates on revision_hash change", () => {
    const root = makeProjectRoot();
    seedEntry(root, "decisions", "KT-DEC-0001", "alpha", "Old summary.");
    const entries = [{ id: "KT-DEC-0001", type: "decision", summary: "KT-DEC-0001" }];

    summaryFallback.resolveOpaqueSummaries(entries, root, "rev-old");
    // Bump revision + change file content — new revision must re-read.
    seedEntry(root, "decisions", "KT-DEC-0001", "alpha", "FRESH summary after meta bump.");

    const second = summaryFallback.resolveOpaqueSummaries(entries, root, "rev-new");
    expect(second[0].summary).toContain("FRESH");
    // Cache file now stamped with the new revision.
    const cache = summaryFallback._readCache(root);
    expect(cache?.revision).toBe("rev-new");
  });
});

describe("_isOpaque (boundary)", () => {
  it("treats trimmed equality as opaque", () => {
    expect(summaryFallback._isOpaque({ id: "KT-DEC-0001", summary: "  KT-DEC-0001  " })).toBe(true);
  });
  it("rejects non-string fields", () => {
    expect(summaryFallback._isOpaque({ id: 123, summary: "x" })).toBe(false);
    expect(summaryFallback._isOpaque(null)).toBe(false);
  });
});
