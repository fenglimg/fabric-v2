import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  parityMatrixSchema,
  type ParityCapability,
  type ParityClient,
} from "@fenglimg/fabric-shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createWerewolfFixtureRoot, runInit } from "../helpers/init-test-utils.ts";

// v2.1.0-rc.1 P5 — two-client parity E2E (S14/S29 parity-E2E; closes the
// P0→P5 parity-matrix chain). The P0 contract stub at
// packages/shared/src/parity/parity-matrix.json declares, per capability, which
// of the 2 clients support it. This test does a single fresh install, then
// asserts EVERY (capability × supported client) cell is actually delivered —
// 100% of the matrix, not a hand-picked subset. A new capability row or a
// regressed installer surfaces here, not in production.

// Loaded via createRequire so the JSON resolves relative to the source tree.
import parityMatrixRaw from "../../../shared/src/parity/parity-matrix.json" assert { type: "json" };

const matrix = parityMatrixSchema.parse(parityMatrixRaw);

// Per-client hook script dir + hook-config file + the JSON path that registers
// each hook event. Claude uses settings.json#hooks.*; Codex uses
// hooks.json#events.*.
const HOOK_SCRIPT = {
  "hook.session-start-hint": "knowledge-hint-broad.cjs",
  "hook.pretooluse-hint": "knowledge-pretooluse.cjs",
  "hook.stop-backlog-hint": "fabric-hint.cjs",
} as const;

const CLIENT_DIR: Record<ParityClient, string> = {
  claudeCode: ".claude",
  codexCLI: ".codex",
};

const SKILL_SLUG = {
  "skill.fabric-archive": "fabric-archive",
  "skill.fabric-review": "fabric-review",
  // W3-C: fabric-import folded into archive source mode (matrix row removed).
  "skill.fabric-sync": "fabric-sync",
  // ADJ-NEWN-1/#4: fabric-store knowledge-store ops skill.
  "skill.fabric-store": "fabric-store",
  "skill.fabric-recall-playbook": "fabric-recall-playbook",
} as const;

// The live MCP tool names, read from the server source that registers them —
// NOT from a hand-maintained list, which is what let the old mcp assertion be
// self-satisfying. Memoized: this is called once per (mcp row × client).
let mcpToolNamesCache: string[] | null = null;
function registeredMcpToolNames(): string[] {
  if (mcpToolNamesCache) return mcpToolNamesCache;
  const toolsDir = join(import.meta.dirname, "../../../server/src/tools");
  const names = readdirSync(toolsDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((f) => [
      ...readFileSync(join(toolsDir, f), "utf8").matchAll(
        /server\.registerTool\(\s*["']([a-z_]+)["']/gu,
      ),
    ])
    .map((m) => m[1] as string);
  // A zero-length result would make `toContain` fail loudly rather than
  // silently pass, but assert it here so the failure names the real cause.
  expect(names.length, "no registerTool calls found — parser drifted").toBeGreaterThan(0);
  mcpToolNamesCache = names;
  return names;
}

let target: string;
const tempRoots: string[] = [];

beforeAll(async () => {
  target = createWerewolfFixtureRoot("itg-parity-e2e");
  tempRoots.push(target);
  await runInit(target);
});

afterEach(() => {
  // single shared install; cleanup deferred to process exit (tmp dir).
});

function hookConfigText(client: ParityClient): string {
  const path =
    client === "claudeCode"
      ? join(target, ".claude/settings.json")
      : join(target, ".codex/hooks.json");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// Assert one (capability, client) cell is delivered by the install.
function assertDelivered(cap: ParityCapability, client: ParityClient): void {
  const dir = CLIENT_DIR[client];
  if (cap.surface === "hook") {
    const script = HOOK_SCRIPT[cap.id as keyof typeof HOOK_SCRIPT];
    // Script copied into the client's hooks dir...
    expect(existsSync(join(target, dir, "hooks", script)), `${cap.id}/${client}: script`).toBe(true);
    // ...and registered in that client's hook config.
    expect(hookConfigText(client), `${cap.id}/${client}: config`).toContain(`${dir}/hooks/${script}`);
    return;
  }
  if (cap.surface === "skill") {
    const slug = SKILL_SLUG[cap.id as keyof typeof SKILL_SLUG];
    expect(
      existsSync(join(target, dir, "skills", slug, "SKILL.md")),
      `${cap.id}/${client}: skill (probe ${dir})`,
    ).toBe(true);
    return;
  }
  if (cap.surface === "mcp") {
    // W4 B6: this cell used to assert `MCP_STORE_AWARE_CONTRACTS[key]` is
    // defined — one static table looked up in another static table, satisfied
    // without the installer or the server doing anything. Every mcp row was a
    // guaranteed pass. Now it walks to the actual producer: the tool name in
    // the matrix row must be a name `packages/server/src/tools/*.ts` really
    // hands to `server.registerTool`. Renaming or dropping a tool server-side
    // without updating the matrix fails here.
    const toolName = cap.id.slice("mcp.".length);
    expect(
      registeredMcpToolNames(),
      `${cap.id}/${client}: no server.registerTool("${toolName}") in packages/server/src/tools`,
    ).toContain(toolName);
    return;
  }
  if (cap.surface === "render") {
    // Bootstrap/render is delivered per client: Claude CLAUDE.md @-import,
    // Codex managed block, all sourced from .fabric/AGENTS.md.
    const renderProbe: Record<ParityClient, string> = {
      claudeCode: "CLAUDE.md",
      codexCLI: "AGENTS.md",
    };
    expect(existsSync(join(target, renderProbe[client])), `${cap.id}/${client}: render`).toBe(true);
    return;
  }
}

describe("P5 — parity-matrix-driven two-client E2E (S14/S29)", () => {
  it("parity-matrix.json validates against the P0 schema", () => {
    expect(matrix.capabilities.length).toBeGreaterThan(0);
  });

  it("every (capability × supported client) cell is delivered by a fresh install", () => {
    const cells: Array<{ cap: string; client: string }> = [];
    for (const cap of matrix.capabilities) {
      for (const client of ["claudeCode", "codexCLI"] as ParityClient[]) {
        if (cap.clients[client]?.supported === true) {
          assertDelivered(cap, client);
          cells.push({ cap: cap.id, client });
        }
      }
    }
    // ADJ-NEWN-2: 11 capabilities × 2 clients all supported = 22 cells
    // (+2 skills fabric-import/sync, +2 MCP plan-context/get-knowledge-sections).
    // Guard against an accidental empty sweep silently "passing".
    expect(cells.length).toBe(matrix.capabilities.length * 2);
  });
});
