import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { digestFor } from "@fenglimg/fabric-shared";

import {
  createMcpRootPinCheck,
  fixMcpRootPins,
  inspectMcpRootPins,
} from "./doctor-mcp-root-pin.js";

// Every case below drives the REAL config files on disk through the real
// inspector, then (for the fix cases) re-reads the rewritten file. An
// installer-managed pin is defined by a digest over the entry, so a test that
// hand-asserts on a synthetic inspection object would pass while the digest
// contract silently changed underneath it.

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const COMMAND = "/usr/bin/node";
const ARGS = ["/srv/fabric-server.js"];

function installerMarker(root: string, clientKind = "ClaudeCodeCLI"): string {
  return `fabric-installer:v1:${digestFor({ clientKind, command: COMMAND, args: ARGS, root })}`;
}

/** Write a `.mcp.json` whose fabric entry carries the given env block. */
function writeMcpJson(projectRoot: string, env: Record<string, string> | undefined): void {
  const fabric: Record<string, unknown> = { command: COMMAND, args: ARGS };
  if (env !== undefined) fabric.env = env;
  writeFileSync(
    join(projectRoot, ".mcp.json"),
    `${JSON.stringify({ mcpServers: { fabric, other: { command: "x", args: [] } } }, null, 2)}\n`,
    "utf8",
  );
}

const t = ((key: string, vars?: Record<string, string>) =>
  vars === undefined ? key : `${key}|${JSON.stringify(vars)}`) as unknown as Parameters<
  typeof createMcpRootPinCheck
>[0];

describe("inspectMcpRootPins", () => {
  it("reports nothing when no client config exists at all", async () => {
    const project = makeDir("rootpin-none-");
    const home = makeDir("rootpin-home-");

    const inspection = await inspectMcpRootPins(project, { homeDir: home });

    expect(inspection).toEqual({ scanned: 0, pins: [] });
  });

  it("reports nothing for an entry with no pin (today's dynamic default)", async () => {
    const project = makeDir("rootpin-dynamic-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, undefined);

    const inspection = await inspectMcpRootPins(project, { homeDir: home });

    expect(inspection.scanned).toBe(1);
    expect(inspection.pins).toEqual([]);
  });

  it("finds an installer-written pin and knows it names this project", async () => {
    const project = makeDir("rootpin-aligned-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: project,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(project),
    });

    const inspection = await inspectMcpRootPins(project, { homeDir: home });

    expect(inspection.pins).toHaveLength(1);
    expect(inspection.pins[0].pinnedRoot).toBe(project);
    expect(inspection.pins[0].matchesProject).toBe(true);
  });

  it("flags a pin naming some OTHER project — the silent cross-project case", async () => {
    const project = makeDir("rootpin-stale-");
    const home = makeDir("rootpin-home-");
    const elsewhere = makeDir("rootpin-elsewhere-");
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: elsewhere,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(elsewhere),
    });

    const inspection = await inspectMcpRootPins(project, { homeDir: home });

    expect(inspection.pins).toHaveLength(1);
    expect(inspection.pins[0].matchesProject).toBe(false);
  });

  // A config file is user territory: only a pin we can PROVE an installer wrote
  // may be reported, because only that one may later be removed.
  it("leaves an operator's deliberate pin alone", async () => {
    const project = makeDir("rootpin-operator-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: "/somewhere/else",
      FABRIC_PROJECT_ROOT_PROVENANCE: "operator:v1",
    });

    expect((await inspectMcpRootPins(project, { homeDir: home })).pins).toEqual([]);
  });

  it("leaves a pin with no provenance marker alone (unprovable authorship)", async () => {
    const project = makeDir("rootpin-ambiguous-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, { FABRIC_PROJECT_ROOT: "/somewhere/else" });

    expect((await inspectMcpRootPins(project, { homeDir: home })).pins).toEqual([]);
  });

  it("leaves a marker whose digest does not match the entry alone", async () => {
    const project = makeDir("rootpin-mismatch-");
    const home = makeDir("rootpin-home-");
    // Marker minted for a DIFFERENT root than the entry pins: we cannot claim
    // authorship of this entry, so it must not be reported (or repaired).
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: project,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker("/other/root"),
    });

    expect((await inspectMcpRootPins(project, { homeDir: home })).pins).toEqual([]);
  });

  // The user-scope file is the worst case: one pin hijacks every repo on the
  // machine. Scanning only the project-local `.mcp.json` would miss it entirely.
  it("scans the user-scope ~/.claude.json, not just the project config", async () => {
    const project = makeDir("rootpin-userscope-");
    const home = makeDir("rootpin-home-");
    const elsewhere = makeDir("rootpin-elsewhere-");
    writeFileSync(
      join(home, ".claude.json"),
      `${JSON.stringify(
        {
          mcpServers: {
            fabric: {
              command: COMMAND,
              args: ARGS,
              env: {
                FABRIC_PROJECT_ROOT: elsewhere,
                FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(elsewhere),
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const inspection = await inspectMcpRootPins(project, { homeDir: home });

    expect(inspection.pins.map((pin) => pin.configPath)).toEqual([join(home, ".claude.json")]);
    expect(inspection.pins[0].matchesProject).toBe(false);
  });

  it("scans the Codex TOML config", async () => {
    const project = makeDir("rootpin-toml-");
    const home = makeDir("rootpin-home-");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const marker = installerMarker(project, "CodexCLI");
    writeFileSync(
      join(home, ".codex", "config.toml"),
      [
        "[mcp_servers.fabric]",
        `command = "${COMMAND}"`,
        `args = ["${ARGS[0]}"]`,
        `env = { FABRIC_PROJECT_ROOT = "${project}", FABRIC_PROJECT_ROOT_PROVENANCE = "${marker}" }`,
        "",
      ].join("\n"),
      "utf8",
    );

    const inspection = await inspectMcpRootPins(project, { homeDir: home });

    expect(inspection.pins).toHaveLength(1);
    expect(inspection.pins[0].clientKind).toBe("CodexCLI");
  });

  it("does not blow up on an unparseable config", async () => {
    const project = makeDir("rootpin-broken-");
    const home = makeDir("rootpin-home-");
    writeFileSync(join(project, ".mcp.json"), "{ not json", "utf8");

    const inspection = await inspectMcpRootPins(project, { homeDir: home });

    expect(inspection).toEqual({ scanned: 1, pins: [] });
  });
});

describe("createMcpRootPinCheck", () => {
  it("is ok when there is no managed pin", () => {
    const check = createMcpRootPinCheck(t, { scanned: 2, pins: [] });
    expect(check.status).toBe("ok");
    expect(check.code).toBeUndefined();
  });

  // A pin that happens to be right today is latent, not broken. Reporting it as
  // an error would train users to ignore this check.
  it("warns (not errors) when the pin still names this project", () => {
    const check = createMcpRootPinCheck(t, {
      scanned: 1,
      pins: [
        { configPath: "/p/.mcp.json", pinnedRoot: "/p", matchesProject: true, clientKind: "ClaudeCodeCLI" },
      ],
    });
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("mcp_root_pin_managed");
  });

  it("errors and advertises a fix when the pin names another project", () => {
    const check = createMcpRootPinCheck(t, {
      scanned: 1,
      pins: [
        { configPath: "/p/.mcp.json", pinnedRoot: "/elsewhere", matchesProject: false, clientKind: "ClaudeCodeCLI" },
      ],
    });
    expect(check.status).toBe("error");
    expect(check.kind).toBe("fixable_error");
    expect(check.fixable).toBe(true);
  });

  // With one stale and one aligned pin, the message must name the stale one —
  // that is the config the user has to look at.
  it("names the stale pin when pins disagree", () => {
    const check = createMcpRootPinCheck(t, {
      scanned: 2,
      pins: [
        { configPath: "/a/.mcp.json", pinnedRoot: "/a", matchesProject: true, clientKind: "ClaudeCodeCLI" },
        { configPath: "/b/.claude.json", pinnedRoot: "/elsewhere", matchesProject: false, clientKind: "ClaudeCodeCLI" },
      ],
    });
    expect(check.message).toContain("/b/.claude.json");
    expect(check.message).toContain("/elsewhere");
  });
});

describe("the repair is wired into `fabric doctor --fix`", () => {
  // The units above prove the repair works; this proves someone calls it. A
  // correct-but-unreachable repair is exactly what this whole check replaced —
  // `repairManagedRootPin` sat in the tree with no production caller at all.
  it("runDoctorFix removes a stale project-scope pin", async () => {
    const { runDoctorFix } = await import("./doctor.js");
    const project = makeDir("rootpin-wired-");
    const elsewhere = makeDir("rootpin-elsewhere-");
    mkdirSync(join(project, ".fabric"), { recursive: true });
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: elsewhere,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(elsewhere),
    });

    await runDoctorFix(project);

    expect(readFileSync(join(project, ".mcp.json"), "utf8")).not.toContain("FABRIC_PROJECT_ROOT");
  });
});

describe("fixMcpRootPins", () => {
  it("removes the pin and leaves the rest of the config intact", async () => {
    const project = makeDir("rootpin-fix-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: project,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(project),
    });

    const result = await fixMcpRootPins(await inspectMcpRootPins(project, { homeDir: home }));

    expect(result.repaired).toEqual([join(project, ".mcp.json")]);
    const after = JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { env?: unknown }>;
    };
    expect(after.mcpServers.fabric.env).toBeUndefined();
    // Other people's MCP registrations are not ours to touch.
    expect(after.mcpServers.other).toEqual({ command: "x", args: [] });
  });

  it("keeps a non-fabric env key that shared the pinned entry", async () => {
    const project = makeDir("rootpin-envkeep-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: project,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(project),
      FABRIC_LOG_LEVEL: "debug",
    });

    await fixMcpRootPins(await inspectMcpRootPins(project, { homeDir: home }));

    const after = JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8")) as {
      mcpServers: { fabric: { env?: Record<string, string> } };
    };
    expect(after.mcpServers.fabric.env).toEqual({ FABRIC_LOG_LEVEL: "debug" });
  });

  it("leaves a verified backup of the config it rewrote", async () => {
    const project = makeDir("rootpin-backup-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: project,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(project),
    });
    const original = readFileSync(join(project, ".mcp.json"), "utf8");

    await fixMcpRootPins(await inspectMcpRootPins(project, { homeDir: home }));

    const { readdirSync } = await import("node:fs");
    const backup = readdirSync(project).find((name) => name.includes(".fabric-backup."));
    expect(backup, "no backup was left behind").toBeDefined();
    expect(readFileSync(join(project, backup as string), "utf8")).toBe(original);
  });

  it("is idempotent — a second run finds nothing left to repair", async () => {
    const project = makeDir("rootpin-idem-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: project,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(project),
    });

    await fixMcpRootPins(await inspectMcpRootPins(project, { homeDir: home }));
    const second = await inspectMcpRootPins(project, { homeDir: home });

    expect(second.pins).toEqual([]);
    expect(await fixMcpRootPins(second)).toEqual({ repaired: [], failed: [] });
  });

  // The inspection and the repair are separate passes, so the config can change
  // in between — another --fix arm rewrites it, or the user removes the pin by
  // hand after reading the report. Reporting a repair that did not happen would
  // make `fabric doctor --fix` claim it fixed a still-broken machine.
  it("does not claim a repair when the pin is already gone by the time it writes", async () => {
    const project = makeDir("rootpin-toctou-");
    const home = makeDir("rootpin-home-");
    writeMcpJson(project, {
      FABRIC_PROJECT_ROOT: project,
      FABRIC_PROJECT_ROOT_PROVENANCE: installerMarker(project),
    });
    const inspection = await inspectMcpRootPins(project, { homeDir: home });
    expect(inspection.pins).toHaveLength(1);

    writeMcpJson(project, undefined);

    expect(await fixMcpRootPins(inspection)).toEqual({ repaired: [], failed: [] });
  });

  it("repairs the Codex TOML config too", async () => {
    const project = makeDir("rootpin-tomlfix-");
    const home = makeDir("rootpin-home-");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const tomlPath = join(home, ".codex", "config.toml");
    const marker = installerMarker(project, "CodexCLI");
    writeFileSync(
      tomlPath,
      [
        "[mcp_servers.fabric]",
        `command = "${COMMAND}"`,
        `args = ["${ARGS[0]}"]`,
        `env = { FABRIC_PROJECT_ROOT = "${project}", FABRIC_PROJECT_ROOT_PROVENANCE = "${marker}" }`,
        "",
        "[other]",
        'keep = "me"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await fixMcpRootPins(await inspectMcpRootPins(project, { homeDir: home }));

    expect(result.repaired).toEqual([tomlPath]);
    const after = readFileSync(tomlPath, "utf8");
    expect(after).not.toContain("FABRIC_PROJECT_ROOT");
    expect(after).toContain('keep = "me"');
  });
});
