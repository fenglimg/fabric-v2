import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HOOK_REGISTRATIONS, hookCommandFor } from "@fenglimg/fabric-shared";

import { fixHookConfigs, inspectHooksWired } from "./doctor-hooks-lints.js";

// A hook that is installed on disk but not registered in the client config is
// invoked by nobody and reports nothing. Doctor is the only surface that can
// notice, so every state below is one a real project has been found in — most
// pointedly the concatenated-JSON settings.json that silenced every hook at
// once while doctor still called the install healthy.

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const CLAUDE_CONFIG = ".claude/settings.json";
const CODEX_CONFIG = ".codex/hooks.json";

function makeRoot(clients: string[] = [".claude"]): string {
  const root = mkdtempSync(join(tmpdir(), "hookcfg-"));
  roots.push(root);
  for (const dir of clients) mkdirSync(join(root, dir), { recursive: true });
  return root;
}

function write(root: string, rel: string, content: string): void {
  writeFileSync(join(root, ...rel.split("/")), content);
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, ...rel.split("/")), "utf8");
}

function claudeCommands(root: string, event: string): string[] {
  const parsed = JSON.parse(read(root, CLAUDE_CONFIG)) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  };
  return (parsed.hooks?.[event] ?? []).flatMap((entry) =>
    (entry.hooks ?? []).map((h) => h.command ?? ""),
  );
}

function fullyWiredClaudeConfig(): string {
  const { configRoot, registrations } = HOOK_REGISTRATIONS.claudeCode;
  const byEvent: Record<string, unknown[]> = {};
  for (const reg of registrations) {
    (byEvent[reg.event] ??= []).push({
      matcher: reg.matcher,
      hooks: [{ type: "command", command: hookCommandFor("claudeCode", reg.hookFile) }],
    });
  }
  return JSON.stringify({ [configRoot]: byEvent }, null, 2);
}

describe("inspectHooksWired", () => {
  it("skips a project with no client directory at all", async () => {
    const root = makeRoot([]);

    expect(await inspectHooksWired(root)).toEqual({
      status: "skipped",
      missingHooks: [],
      unparseableConfigs: [],
      missingConfigs: [],
    });
  });

  it("reports an absent config separately from an unparseable one", async () => {
    const absent = makeRoot();
    const broken = makeRoot();
    write(broken, CLAUDE_CONFIG, "{ not json");

    const absentResult = await inspectHooksWired(absent);
    expect(absentResult.status).toBe("config-missing");
    expect(absentResult.missingConfigs).toEqual([CLAUDE_CONFIG]);

    const brokenResult = await inspectHooksWired(broken);
    expect(brokenResult.status).toBe("config-unparseable");
    expect(brokenResult.unparseableConfigs).toEqual([CLAUDE_CONFIG]);
  });

  it("flags the concatenated-JSON settings.json that silenced every hook", async () => {
    // Two complete JSON objects written back to back. Each half is valid on its
    // own, so anything eyeballing the file sees plausible config — but the
    // client cannot parse it and drops every hook in it.
    const root = makeRoot();
    write(root, CLAUDE_CONFIG, `${fullyWiredClaudeConfig()}\n${fullyWiredClaudeConfig()}`);

    const result = await inspectHooksWired(root);

    expect(result.status).toBe("config-unparseable");
    expect(result.unparseableConfigs).toEqual([CLAUDE_CONFIG]);
  });

  it("reports every registration the config is missing, not just the first", async () => {
    const root = makeRoot();
    // Stop only — every other Claude Code registration is absent. The
    // hand-written predecessor of this check knew about 3 of them and would
    // have called a config missing PostToolUse + SessionEnd healthy.
    write(
      root,
      CLAUDE_CONFIG,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: hookCommandFor("claudeCode", "fabric-hint.cjs") }],
            },
          ],
        },
      }),
    );

    const result = await inspectHooksWired(root);

    expect(result.status).toBe("incomplete");
    expect(result.missingHooks).toEqual([
      `${CLAUDE_CONFIG} SessionStart:knowledge-hint-broad.cjs`,
      `${CLAUDE_CONFIG} PreToolUse:knowledge-pretooluse.cjs`,
      `${CLAUDE_CONFIG} PostToolUse:post-tooluse-mutation.cjs`,
      `${CLAUDE_CONFIG} SessionEnd:session-end-marker.cjs`,
      `${CLAUDE_CONFIG} SubagentStart:knowledge-hint-subagent.cjs`,
    ]);
  });

  it("checks Codex too, and only the clients that are installed", async () => {
    const bothClients = makeRoot([".claude", ".codex"]);
    write(bothClients, CLAUDE_CONFIG, fullyWiredClaudeConfig());

    const result = await inspectHooksWired(bothClients);

    // Claude is fully wired, so every complaint must be Codex's.
    expect(result.missingConfigs).toEqual([CODEX_CONFIG]);
    expect(result.status).toBe("config-missing");

    const claudeOnly = makeRoot();
    write(claudeOnly, CLAUDE_CONFIG, fullyWiredClaudeConfig());
    expect(await inspectHooksWired(claudeOnly)).toMatchObject({ status: "ok" });
  });
});

describe("fixHookConfigs", () => {
  it("writes a config from scratch when the client has none", async () => {
    const root = makeRoot();

    const result = await fixHookConfigs(root);

    expect(result.rewritten).toEqual([CLAUDE_CONFIG]);
    expect(result.preserved).toEqual([]);
    expect(await inspectHooksWired(root)).toMatchObject({ status: "ok" });
  });

  it("fills only the missing registrations and leaves the user's hooks alone", async () => {
    const root = makeRoot();
    const userHook = "./my-own-stop-hook.cjs";
    write(
      root,
      CLAUDE_CONFIG,
      JSON.stringify({
        permissions: { allow: ["Bash(ls:*)"] },
        hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: userHook }] }] },
      }),
    );

    await fixHookConfigs(root);

    expect(claudeCommands(root, "Stop")).toEqual([
      userHook,
      hookCommandFor("claudeCode", "fabric-hint.cjs"),
    ]);
    const parsed = JSON.parse(read(root, CLAUDE_CONFIG)) as { permissions?: unknown };
    expect(parsed.permissions).toEqual({ allow: ["Bash(ls:*)"] });
    expect(await inspectHooksWired(root)).toMatchObject({ status: "ok" });
  });

  it("preserves an unparseable config beside itself instead of overwriting it", async () => {
    const root = makeRoot();
    const corrupt = `${fullyWiredClaudeConfig()}\n${fullyWiredClaudeConfig()}`;
    write(root, CLAUDE_CONFIG, corrupt);

    const result = await fixHookConfigs(root);

    expect(result.preserved).toHaveLength(1);
    const [{ config, preservedAs }] = result.preserved;
    expect(config).toBe(CLAUDE_CONFIG);
    expect(preservedAs).toMatch(/^\.claude\/settings\.json\.broken-\d+$/);
    // The user's bytes survive verbatim — the operator merges them back by hand.
    expect(read(root, preservedAs)).toBe(corrupt);
    expect(await inspectHooksWired(root)).toMatchObject({ status: "ok" });
  });

  it("is idempotent: a second run rewrites nothing and creates no sidecar", async () => {
    const root = makeRoot();
    await fixHookConfigs(root);
    const after = read(root, CLAUDE_CONFIG);

    const second = await fixHookConfigs(root);

    expect(second.rewritten).toEqual([]);
    expect(second.preserved).toEqual([]);
    expect(read(root, CLAUDE_CONFIG)).toBe(after);
    expect(readdirSync(join(root, ".claude")).filter((f) => f.includes(".broken-"))).toEqual([]);
  });

  it("does not create a config for a client that is not installed", async () => {
    const root = makeRoot([".claude"]);

    await fixHookConfigs(root);

    expect(readdirSync(root)).not.toContain(".codex");
  });

  it("repairs every installed client in one pass", async () => {
    const root = makeRoot([".claude", ".codex"]);

    const result = await fixHookConfigs(root);

    expect(result.rewritten.sort()).toEqual([CODEX_CONFIG, CLAUDE_CONFIG].sort());
    expect(await inspectHooksWired(root)).toMatchObject({ status: "ok" });
  });
});
