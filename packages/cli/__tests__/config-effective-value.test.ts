/**
 * config-single-home W6 — `fabric config` reports the value in FORCE.
 *
 * W5 relocated every policy knob to `~/.fabric/fabric-global.json` but only
 * rerouted the `--set` write path. `--list` / `--get` kept reading
 * `.fabric/fabric-config.json`, which W5 had just emptied to identity-only, so
 * every field printed `null` no matter what the hooks and the server actually
 * resolved — the introspection surface contradicted the runtime.
 *
 * These cases pin the contract the other direction: what `config` prints is
 * resolved through the same cascade the readers use, and it names the layer.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configCmd } from "../src/commands/config.ts";

const dirs: string[] = [];
let savedHome: string | undefined;

function makeRepo(identity: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-cfg-effective-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  writeFileSync(
    join(dir, ".fabric", "fabric-config.json"),
    JSON.stringify(identity, null, 2),
    "utf8",
  );
  return dir;
}

function writeGlobal(config: Record<string, unknown>): void {
  const home = process.env.FABRIC_HOME as string;
  mkdirSync(join(home, ".fabric"), { recursive: true });
  writeFileSync(
    join(home, ".fabric", "fabric-global.json"),
    JSON.stringify({ uid: "u-test", stores: [], ...config }, null, 2),
    "utf8",
  );
}

/** Run configCmd and return every console.log line it emitted. */
async function runConfig(args: Record<string, unknown>): Promise<string[]> {
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
    lines.push(String(msg ?? ""));
  });
  try {
    await configCmd.run!({ args, rawArgs: [], cmd: configCmd, data: undefined } as never);
  } finally {
    logSpy.mockRestore();
  }
  return lines;
}

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-cfg-effective-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
  process.exitCode = 0;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  vi.restoreAllMocks();
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("config-single-home W6: --list reports the effective value, not the repo file", () => {
  it("a machine-wide default surfaces as its value tagged `defaults`", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({ defaults: { nudge_mode: "silent" } });

    const lines = await runConfig({ target: repo, list: true });

    expect(lines).toContain('nudge_mode="silent" (defaults)');
  });

  it("a per-project exception wins over the machine-wide default", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({
      defaults: { nudge_mode: "silent" },
      projects: { "p-1": { nudge_mode: "verbose" } },
    });

    const lines = await runConfig({ target: repo, list: true });

    expect(lines).toContain('nudge_mode="verbose" (project)');
  });

  it("an unset knob prints its shipped default tagged `default`, never null", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({});

    const lines = await runConfig({ target: repo, list: true });

    // The regression this file exists for: every line used to read `=null`.
    expect(lines.some((l) => l.includes("=null"))).toBe(false);
    expect(lines).toContain("archive_hint_hours=24 (default)");
  });

  it("--json carries the source and home per field", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({ defaults: { archive_edit_threshold: 40 } });

    const lines = await runConfig({ target: repo, list: true, json: true });
    const parsed = JSON.parse(lines.join("\n")) as {
      fields: Array<{ key: string; value: unknown; source: string; home: string }>;
    };

    const edit = parsed.fields.find((f) => f.key === "archive_edit_threshold");
    expect(edit).toEqual({
      key: "archive_edit_threshold",
      value: 40,
      type: "number",
      home: "preference",
      source: "defaults",
    });
    // underseed_node_threshold is a CORPUS knob — it must not claim a
    // preference home, or `--set` would route it where no reader looks.
    expect(parsed.fields.find((f) => f.key === "underseed_node_threshold")?.home).toBe("corpus");
  });
});

describe("config-single-home W6: --get resolves through the cascade", () => {
  it("returns the machine-wide value for an unscoped repo", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({ defaults: { archive_hint_hours: 72 } });

    expect(await runConfig({ target: repo, get: "archive_hint_hours" })).toEqual(["72"]);
  });

  it("falls back to the shipped default when no layer set the key", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({});

    expect(await runConfig({ target: repo, get: "archive_hint_hours" })).toEqual(["24"]);
  });

  it("reads fabric_language off the global root, not the repo file", async () => {
    const repo = makeRepo({ project_id: "p-1", fabric_language: "en" });
    writeGlobal({ language: "zh-CN" });

    expect(await runConfig({ target: repo, get: "fabric_language" })).toEqual(["zh-CN"]);
  });

  it("rejects a key the panel does not describe", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runConfig({ target: repo, get: "not_a_key" });

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("unknown config key");
  });
});

describe("config-single-home W6: --set validates and routes by the field's home", () => {
  it("a preference knob lands in global defaults and reads back", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({});

    await runConfig({ target: repo, set: "archive_hint_hours", value: "48" });

    expect(await runConfig({ target: repo, get: "archive_hint_hours" })).toEqual(["48"]);
  });

  it("--scope project lands in projects[<project_id>] and outranks defaults", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({ defaults: { archive_hint_hours: 12 } });

    await runConfig({ target: repo, set: "archive_hint_hours", value: "48", scope: "project" });

    const lines = await runConfig({ target: repo, list: true });
    expect(lines).toContain("archive_hint_hours=48 (project)");
  });

  it("rejects a value the field's own validator refuses", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runConfig({ target: repo, set: "archive_hint_hours", value: "-3" });

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("invalid value");
    // …and nothing was written, so the reader still sees the shipped default.
    expect(await runConfig({ target: repo, get: "archive_hint_hours" })).toEqual(["24"]);
  });

  it("refuses --scope on a corpus knob (it has exactly one home)", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runConfig({
      target: repo,
      set: "underseed_node_threshold",
      value: "5",
      scope: "defaults",
    });

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("--scope does not apply");
  });

  it("fails loudly when a corpus knob has no bound team store to write to", async () => {
    const repo = makeRepo({ project_id: "p-1" });
    writeGlobal({});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runConfig({ target: repo, set: "underseed_node_threshold", value: "5" });

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/store bind/);
  });
});
