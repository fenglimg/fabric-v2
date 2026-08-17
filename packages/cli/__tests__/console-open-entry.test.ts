/**
 * `POST /api/open` — the console's first real write endpoint.
 *
 * The design point under test is that the request carries an ENTRY ID, never a
 * path: the file is looked up from the same store enumeration the read
 * endpoints use, so the set of openable files is closed by construction. A
 * client-supplied path guarded by a prefix check would instead be correct only
 * as long as the check has no hole in it.
 */

import { describe, expect, it, vi } from "vitest";

import { openKnowledgeEntry } from "../src/console/open-entry.js";

const collectMock = vi.hoisted(() => vi.fn());
vi.mock("@fenglimg/fabric-server", () => ({
  collectStoreCanonicalEntries: collectMock,
}));

const ENTRY = {
  stableId: "KT-DEC-0001",
  qualifiedId: "fabric-team:KT-DEC-0001",
  file: "/Users/somebody/.fabric/stores/team/knowledge/decisions/KT-DEC-0001--x.md",
  type: "decisions",
  layer: "team" as const,
  body: "---\nid: KT-DEC-0001\n---\n# x\n",
  description: {} as never,
};

describe("openKnowledgeEntry", () => {
  it("opens the file the store says belongs to that id", async () => {
    collectMock.mockResolvedValue([ENTRY]);
    const opened: string[] = [];
    const result = await openKnowledgeEntry("/repo", "fabric-team:KT-DEC-0001", (f) =>
      opened.push(f),
    );
    expect(result).toEqual({ ok: true, file: ENTRY.file });
    expect(opened).toEqual([ENTRY.file]);
  });

  it("looks across every mounted store, not just the read-set", async () => {
    // The console's cross-store view can show an entry the read-set excludes.
    // Enumerating narrowly would make the button work on some rows and silently
    // fail on others depending on the source toggle.
    collectMock.mockResolvedValue([ENTRY]);
    await openKnowledgeEntry("/repo", ENTRY.qualifiedId, () => {});
    expect(collectMock).toHaveBeenCalledWith("/repo", { allStores: true });
  });

  it("refuses an unknown id", async () => {
    collectMock.mockResolvedValue([ENTRY]);
    const opened: string[] = [];
    const result = await openKnowledgeEntry("/repo", "other:KT-NOPE-9999", (f) => opened.push(f));
    expect(result).toEqual({ ok: false, status: 404, error: "unknown entry" });
    expect(opened).toEqual([]);
  });

  it("cannot be steered at a path — a path-shaped id is just an unknown id", async () => {
    // The traversal attempt that would matter if the endpoint took paths.
    collectMock.mockResolvedValue([ENTRY]);
    const opened: string[] = [];
    for (const attempt of [
      "../../../../etc/passwd",
      "/etc/passwd",
      "fabric-team:../../../../etc/passwd",
    ]) {
      const result = await openKnowledgeEntry("/repo", attempt, (f) => opened.push(f));
      expect(result.ok).toBe(false);
    }
    expect(opened).toEqual([]);
  });

  it("rejects a missing or non-string id before touching the store", async () => {
    collectMock.mockClear();
    collectMock.mockResolvedValue([ENTRY]);
    for (const bad of [undefined, null, "", 42, { qualifiedId: "x" }]) {
      const result = await openKnowledgeEntry("/repo", bad, () => {});
      expect(result).toEqual({ ok: false, status: 400, error: "qualifiedId is required" });
    }
    expect(collectMock).not.toHaveBeenCalled();
  });

  it("reports an opener failure instead of throwing out of the request", async () => {
    collectMock.mockResolvedValue([ENTRY]);
    const result = await openKnowledgeEntry("/repo", ENTRY.qualifiedId, () => {
      throw new Error("no handler for .md");
    });
    expect(result).toEqual({ ok: false, status: 500, error: "no handler for .md" });
  });
});
