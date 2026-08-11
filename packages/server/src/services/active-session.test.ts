import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ACTIVE_SESSION_FILE_PREFIX,
  ACTIVE_SESSION_FILE_SUFFIX,
  ACTIVE_SESSION_MAX_AGE_MS,
  coalesceSessionId,
  getPinnedSessionId,
  readActiveSessionId,
  resetPinnedSessionId,
  resolveSessionId,
} from "./active-session.js";

const tempDirs: string[] = [];

beforeEach(() => {
  // The pin is process-global by design; tests share a process, so each case
  // must start from an unpinned server.
  resetPinnedSessionId();
});

afterEach(async () => {
  for (const d of tempDirs.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

async function emptyProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-active-sess-"));
  tempDirs.push(root);
  await mkdir(join(root, ".fabric", ".cache"), { recursive: true });
  return root;
}

/** Stamp one window's sidecar, exactly as the hooks do. */
async function stamp(root: string, sessionId: string, ts: number): Promise<void> {
  await writeFile(
    join(
      root,
      ".fabric",
      ".cache",
      `${ACTIVE_SESSION_FILE_PREFIX}${sessionId}${ACTIVE_SESSION_FILE_SUFFIX}`,
    ),
    JSON.stringify({ session_id: sessionId, ts }),
    "utf8",
  );
}

async function projectWithActiveSession(sessionId: string, ts: number): Promise<string> {
  const root = await emptyProject();
  await stamp(root, sessionId, ts);
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
    await writeFile(
      join(cacheDir, `${ACTIVE_SESSION_FILE_PREFIX}bad${ACTIVE_SESSION_FILE_SUFFIX}`),
      "{not json",
      "utf8",
    );
    await expect(readActiveSessionId(root)).resolves.toBeNull();
  });

  // The whole point of the per-session layout: two live windows must read as
  // "ambiguous", not as whichever one stamped last.
  it("refuses to guess when two windows are live", async () => {
    const now = Date.now();
    const root = await emptyProject();
    await stamp(root, "sess-window-a", now - 5000);
    await stamp(root, "sess-window-b", now - 1000);
    await expect(readActiveSessionId(root, now)).resolves.toBeNull();
  });

  it("still answers when the second window's stamp has aged out", async () => {
    const now = Date.now();
    const root = await emptyProject();
    await stamp(root, "sess-window-a", now - 1000);
    await stamp(root, "sess-window-b", now - ACTIVE_SESSION_MAX_AGE_MS - 1);
    await expect(readActiveSessionId(root, now)).resolves.toBe("sess-window-a");
  });
});

describe("resolveSessionId", () => {
  it("returns the explicit id and pins the process", async () => {
    const root = await emptyProject();
    await expect(resolveSessionId(root, "sess-explicit")).resolves.toBe("sess-explicit");
    expect(getPinnedSessionId()).toBe("sess-explicit");
  });

  // KT-PIT-0053: the agent routinely omits the optional session_id. The pin is
  // what keeps those calls attributed without the reader having to guess — and
  // it must hold even while a neighbouring window is stamping the shared cache
  // dir, which is the normal state of affairs in multi-window work.
  it("holds the pin against a neighbour window that stamped less recently", async () => {
    const now = Date.now();
    const root = await emptyProject();
    await stamp(root, "sess-neighbour", now - 5000);
    await stamp(root, "sess-mine", now - 1000);
    await resolveSessionId(root, "sess-mine", now - 5000);
    await expect(resolveSessionId(root, undefined, now)).resolves.toBe("sess-mine");
  });

  // A stamp from another session newer than anything known about mine reads
  // identically whether it is a neighbour window or a post-`/clear` session in
  // this very process. The two want opposite answers, so neither is given.
  it("returns undefined when the pin is contested by a newer foreign stamp", async () => {
    const now = Date.now();
    const root = await emptyProject();
    await resolveSessionId(root, "sess-mine", now - 10_000);
    await stamp(root, "sess-other", now - 1000);
    await expect(resolveSessionId(root, undefined, now)).resolves.toBeUndefined();
  });

  // ...and it self-corrects as soon as the agent passes the id again.
  it("re-pins from the next explicit id after being contested", async () => {
    const now = Date.now();
    const root = await emptyProject();
    await resolveSessionId(root, "sess-before-clear", now - 10_000);
    await stamp(root, "sess-after-clear", now - 1000);
    await expect(resolveSessionId(root, undefined, now)).resolves.toBeUndefined();
    await expect(resolveSessionId(root, "sess-after-clear", now)).resolves.toBe(
      "sess-after-clear",
    );
    expect(getPinnedSessionId()).toBe("sess-after-clear");
  });

  it("returns undefined when unpinned and the sidecar is ambiguous", async () => {
    const now = Date.now();
    const root = await emptyProject();
    await stamp(root, "sess-window-a", now - 5000);
    await stamp(root, "sess-window-b", now - 1000);
    await expect(resolveSessionId(root, undefined, now)).resolves.toBeUndefined();
  });
});
