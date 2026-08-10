import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HOOK_CLIENTS,
  HOOK_REGISTRATIONS,
  fabricHookConfigFor,
  hookCommandFor,
  hookConfigArrayPaths,
  mergeFabricHookRegistrations,
  type HookClient,
} from "@fenglimg/fabric-shared";

import { HOOK_CONFIG_ARRAY_PATHS, HOOK_CONFIG_TARGETS } from "../src/install/skills-and-hooks.ts";

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

describe("hook registration table vs shipped template configs", () => {
  it.each(HOOK_CLIENTS)("%s config matches HOOK_REGISTRATIONS exactly", (client) => {
    expect(readConfig(client)).toEqual(fabricHookConfigFor(client));
  });

  // `doctor --fix` restores a config with mergeFabricHookRegistrations rather
  // than by copying the template, so merging into nothing must land exactly
  // where install would have. Without this the two writers could drift and only
  // a user with a broken config would ever find out.
  it.each(HOOK_CLIENTS)("%s: merging into an empty config reproduces the template", (client) => {
    expect(mergeFabricHookRegistrations({}, client)).toEqual(readConfig(client));
    expect(mergeFabricHookRegistrations(undefined, client)).toEqual(readConfig(client));
  });

  it.each(HOOK_CLIENTS)("%s: merge is idempotent and preserves foreign entries", (client) => {
    const { configRoot, registrations } = HOOK_REGISTRATIONS[client];
    const userEntry = { command: "./my-own-hook.cjs" };
    const seeded = { keepMe: 1, [configRoot]: { [registrations[0]!.event]: [userEntry] } };

    const once = mergeFabricHookRegistrations(seeded, client);
    expect(once).toEqual(mergeFabricHookRegistrations(once, client));
    expect(once.keepMe).toBe(1);

    const firstEvent = (once[configRoot] as Record<string, unknown[]>)[registrations[0]!.event];
    // The user's entry stays first and untouched; fabric's is appended after it.
    expect(firstEvent?.[0]).toEqual(userEntry);
    const commands = (firstEvent ?? []).flatMap((entry) => {
      const record = entry as { command?: unknown; hooks?: Array<{ command?: unknown }> };
      const own = typeof record.command === "string" ? [record.command] : [];
      const nested = (record.hooks ?? []).map((h) => h.command).filter((c): c is string =>
        typeof c === "string",
      );
      return [...own, ...nested];
    });
    expect(commands).toContain(hookCommandFor(client, registrations[0]!.hookFile));
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

  // Doctor reads each client's config from the table; install writes it from
  // HOOK_CONFIG_TARGETS. Different file names would make doctor inspect a path
  // install never writes — and report a healthy install as unwired.
  it("points at the same config file install writes", () => {
    for (const client of HOOK_CLIENTS) {
      expect(HOOK_REGISTRATIONS[client].configFile).toBe(HOOK_CONFIG_TARGETS[client]);
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
