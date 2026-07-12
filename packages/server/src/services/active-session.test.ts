import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  ACTIVE_SESSION_MAX_AGE_MS,
  coalesceSessionId,
  readActiveSessionId,
} from "./active-session.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const d of tempDirs.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

async function projectWithActiveSession(
  sessionId: string,
  ts: number,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-active-sess-"));
  tempDirs.push(root);
  const cacheDir = join(root, ".fabric", ".cache");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "active-session.json"),
    JSON.stringify({ session_id: sessionId, ts }),
    "utf8",
  );
  return root;
}

describe("coalesceSessionId", () => {
  it("prefers explicit over fallback", () => {
    expect(coalesceSessionId("explicit", "fallback")).toBe("explicit");
  });

  it("uses fallback when explicit is empty/undefined", () => {
    expect(coalesceSessionId(undefined, "fallback")).toBe("fallback");
    expect(coalesceSessionId("", "fallback")).toBe("fallback");
  });

  it("returns undefined when both missing", () => {
    expect(coalesceSessionId(undefined, null)).toBeUndefined();
    expect(coalesceSessionId("", "")).toBeUndefined();
  });
});

describe("readActiveSessionId", () => {
  it("returns session_id from a fresh sidecar", async () => {
    const now = Date.now();
    const root = await projectWithActiveSession("sess-fresh", now - 1000);
    await expect(readActiveSessionId(root, now)).resolves.toBe("sess-fresh");
  });

  it("returns null when sidecar is older than max age", async () => {
    const now = Date.now();
    const root = await projectWithActiveSession(
      "sess-stale",
      now - ACTIVE_SESSION_MAX_AGE_MS - 1,
    );
    await expect(readActiveSessionId(root, now)).resolves.toBeNull();
  });

  it("returns null when sidecar ts is in the future", async () => {
    const now = Date.now();
    const root = await projectWithActiveSession("sess-future", now + 60_000);
    await expect(readActiveSessionId(root, now)).resolves.toBeNull();
  });

  it("returns null when file missing or malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "fabric-active-sess-empty-"));
    tempDirs.push(root);
    await expect(readActiveSessionId(root)).resolves.toBeNull();

    const cacheDir = join(root, ".fabric", ".cache");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, "active-session.json"), "{not json", "utf8");
    await expect(readActiveSessionId(root)).resolves.toBeNull();
  });
});
