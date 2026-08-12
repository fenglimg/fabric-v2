import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  INSTALL_MANIFEST_REL,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  hashInstalledFile,
} from "@fenglimg/fabric-shared";

import { inspectInstallCopyDrift } from "./doctor-install-drift.js";

// The gap this check exists for: `hooks_content_drift` compares .claude
// against .codex, so it only fires when the two DISAGREE. A stale install is
// stale on both sides — equally stale reads as healthy there. Comparing
// against the manifest install left behind is the only way to see it, which is
// the KT-PIT-0056 class (user runs hooks predating the fix commit forever).

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const TRACKED = ".claude/hooks/fabric-hint.cjs";
const TRACKED_TWIN = ".codex/hooks/fabric-hint.cjs";

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "installdrift-"));
  roots.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  return root;
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

/** Seed files plus a manifest that vouches for exactly those bytes. */
function install(root: string, files: Record<string, string>, version = "2.1.0"): void {
  const manifestFiles: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files)) {
    write(root, rel, content);
    manifestFiles[rel] = hashInstalledFile(content);
  }
  write(
    root,
    INSTALL_MANIFEST_REL,
    JSON.stringify({
      schema_version: INSTALL_MANIFEST_SCHEMA_VERSION,
      fabric_version: version,
      generated_at: "2026-08-10T00:00:00.000Z",
      files: manifestFiles,
    }),
  );
}

describe("inspectInstallCopyDrift", () => {
  it("skips a project that has no manifest at all", async () => {
    const root = makeRoot();
    write(root, TRACKED, "#!/usr/bin/env node\n");

    expect(await inspectInstallCopyDrift(root)).toEqual({
      status: "no-manifest",
      fabricVersion: null,
      tracked: 0,
      drifts: [],
    });
  });

  it("reports untouched copies as ok and carries the recorded version", async () => {
    const root = makeRoot();
    install(root, { [TRACKED]: "a\n", [TRACKED_TWIN]: "a\n" }, "2.1.3");

    const result = await inspectInstallCopyDrift(root);

    expect(result.status).toBe("ok");
    expect(result.tracked).toBe(2);
    expect(result.fabricVersion).toBe("2.1.3");
    expect(result.drifts).toEqual([]);
  });

  it("catches BOTH clients drifting together — the case cross-client parity misses", async () => {
    const root = makeRoot();
    install(root, { [TRACKED]: "canonical\n", [TRACKED_TWIN]: "canonical\n" });
    // Equally stale on both sides: the two copies still agree with each other,
    // so hooks_content_drift sees nothing. Only the manifest knows better.
    write(root, TRACKED, "hand-edited\n");
    write(root, TRACKED_TWIN, "hand-edited\n");

    const result = await inspectInstallCopyDrift(root);

    expect(result.status).toBe("drifted");
    expect(result.drifts).toEqual([
      { path: TRACKED, kind: "modified" },
      { path: TRACKED_TWIN, kind: "modified" },
    ]);
  });

  it("distinguishes a deleted copy from an edited one", async () => {
    const root = makeRoot();
    install(root, { [TRACKED]: "a\n", [TRACKED_TWIN]: "b\n" });
    write(root, TRACKED, "edited\n");
    rmSync(join(root, ...TRACKED_TWIN.split("/")));

    const result = await inspectInstallCopyDrift(root);

    expect(result.drifts).toEqual([
      { path: TRACKED, kind: "modified" },
      { path: TRACKED_TWIN, kind: "missing" },
    ]);
  });

  it("reports drifts sorted by path so the report is stable across runs", async () => {
    const root = makeRoot();
    const files = {
      ".codex/hooks/z-last.cjs": "z\n",
      ".claude/hooks/a-first.cjs": "a\n",
      ".claude/hooks/m-middle.cjs": "m\n",
    };
    install(root, files);
    for (const rel of Object.keys(files)) write(root, rel, "changed\n");

    const result = await inspectInstallCopyDrift(root);

    expect(result.drifts.map((d) => d.path)).toEqual([
      ".claude/hooks/a-first.cjs",
      ".claude/hooks/m-middle.cjs",
      ".codex/hooks/z-last.cjs",
    ]);
  });

  it("treats a corrupt manifest as unreadable rather than as zero drift", async () => {
    const root = makeRoot();
    write(root, TRACKED, "a\n");
    write(root, INSTALL_MANIFEST_REL, "{ not json");

    const result = await inspectInstallCopyDrift(root);

    // The dangerous failure would be reporting "ok" here — silently vouching
    // for copies nothing verified.
    expect(result.status).toBe("manifest-unreadable");
  });

  it("rejects a manifest written by an incompatible schema version", async () => {
    const root = makeRoot();
    write(root, TRACKED, "a\n");
    write(
      root,
      INSTALL_MANIFEST_REL,
      JSON.stringify({
        schema_version: INSTALL_MANIFEST_SCHEMA_VERSION + 1,
        fabric_version: "9.9.9",
        generated_at: "2026-08-10T00:00:00.000Z",
        files: { [TRACKED]: "deadbeef" },
      }),
    );

    expect((await inspectInstallCopyDrift(root)).status).toBe("manifest-unreadable");
  });

  it("does not flag files that exist on disk but are outside the manifest", async () => {
    const root = makeRoot();
    install(root, { [TRACKED]: "a\n" });
    // A user's own hook. Install never wrote it, so it is not ours to police.
    write(root, ".claude/hooks/my-own-hook.cjs", "whatever\n");

    const result = await inspectInstallCopyDrift(root);

    expect(result.status).toBe("ok");
    expect(result.tracked).toBe(1);
  });
});
