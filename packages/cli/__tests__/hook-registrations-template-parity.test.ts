import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HOOK_CLIENTS,
  HOOK_REGISTRATIONS,
  hookCommandFor,
  hookConfigArrayPaths,
  type HookClient,
  type HookRegistration,
} from "@fenglimg/fabric-shared";

import { HOOK_CONFIG_ARRAY_PATHS } from "../src/install/skills-and-hooks.ts";

// `HOOK_REGISTRATIONS` is what doctor checks for; these JSON files are what
// install actually ships. If they drift, doctor certifies a config it never
// verified — which is how the wired-hooks check came to assert 3 of 5 entries.
// So: derive the expected JSON from the table and compare against the file on
// disk. Adding a hook to either side alone fails here.

const CONFIG_FILES: Record<HookClient, string> = {
  claudeCode: "claude-code.json",
  codex: "codex-hooks.json",
};

function readConfig(client: HookClient): Record<string, unknown> {
  const path = fileURLToPath(
    new URL(`../templates/hooks/configs/${CONFIG_FILES[client]}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

// Claude Code nests each entry as { matcher, hooks: [{ type, command }] } and
// always spells the matcher out; Codex puts the command on the entry itself and
// omits a "*" matcher entirely.
function expectedEntry(client: HookClient, reg: HookRegistration): Record<string, unknown> {
  const command = hookCommandFor(client, reg.hookFile);
  if (client === "claudeCode") {
    return { matcher: reg.matcher, hooks: [{ type: "command", command }] };
  }
  return reg.matcher === "*" ? { command } : { matcher: reg.matcher, command };
}

function expectedConfig(client: HookClient): Record<string, unknown> {
  const { configRoot, registrations } = HOOK_REGISTRATIONS[client];
  const byEvent: Record<string, Array<Record<string, unknown>>> = {};
  for (const reg of registrations) {
    (byEvent[reg.event] ??= []).push(expectedEntry(client, reg));
  }
  return { [configRoot]: byEvent };
}

describe("hook registration table vs shipped template configs", () => {
  it.each(HOOK_CLIENTS)("%s config matches HOOK_REGISTRATIONS exactly", (client) => {
    expect(readConfig(client)).toEqual(expectedConfig(client));
  });

  it("registers every hook script the table names, under a real client dir", () => {
    for (const client of HOOK_CLIENTS) {
      const { clientDir, registrations } = HOOK_REGISTRATIONS[client];
      expect(registrations.length).toBeGreaterThan(0);
      for (const reg of registrations) {
        expect(reg.hookFile).toMatch(/^[a-z0-9-]+\.cjs$/);
        expect(hookCommandFor(client, reg.hookFile)).toContain(`${clientDir}/hooks/${reg.hookFile}`);
      }
    }
  });

  // Two directions, and they are NOT the same assertion:
  //   * every registered event must be an append path, or a re-install
  //     array-REPLACEs that slot and drops the user's own hooks (KT-GLD-0003);
  //   * every extra append path must be a deliberate legacy prune target, so a
  //     genuinely stale one cannot hide among them.
  it.each([
    ["claudeCode", ["hooks.UserPromptSubmit"]],
    ["codex", []],
  ] as const)("%s append paths cover every registered event", (client, legacyOnly) => {
    const registered = new Set(hookConfigArrayPaths(client));
    const merged = HOOK_CONFIG_ARRAY_PATHS[client];

    for (const path of registered) {
      expect(merged).toContain(path);
    }
    expect(merged.filter((path) => !registered.has(path))).toEqual(legacyOnly);
  });
});
