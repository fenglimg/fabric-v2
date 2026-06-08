import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MCP_STORE_AWARE_CONTRACTS,
  PARITY_CLIENTS,
  parityMatrixSchema,
  type ParityCapability,
  type ParityClient,
} from "@fenglimg/fabric-shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createWerewolfFixtureRoot, runInit } from "../helpers/init-test-utils.ts";

// v2.1.0-rc.1 P5 — client parity E2E (S14/S29 parity-E2E; closes the
// P0→P5 parity-matrix chain). The P0 contract stub at
// packages/shared/src/parity/parity-matrix.json declares, per capability, which
// clients support it. This test does a single fresh install, then
// asserts EVERY (capability × supported client) cell is actually delivered —
// 100% of the matrix, not a hand-picked subset. A new capability row or a
// regressed installer surfaces here, not in production.

// Loaded via createRequire so the JSON resolves relative to the source tree.
import parityMatrixRaw from "../../../shared/src/parity/parity-matrix.json" assert { type: "json" };

const matrix = parityMatrixSchema.parse(parityMatrixRaw);

// Per-client hook script dir + hook-config file + the JSON path that registers
// each hook event. Cursor uses camelCase event keys (cursor.com/docs/hooks);
// Claude uses settings.json#hooks.*; Codex uses hooks.json#events.*.
const HOOK_SCRIPT = {
  "hook.session-start-hint": "knowledge-hint-broad.cjs",
  "hook.pretooluse-hint": "knowledge-hint-narrow.cjs",
  "hook.stop-backlog-hint": "fabric-hint.cjs",
} as const;

const CLIENT_DIR: Record<ParityClient, string> = {
  claudeCode: ".claude",
  claudeCodeDesktop: ".claude",
  cursor: ".cursor",
  codexCLI: ".codex",
  codexDesktop: ".codex",
};

const SKILL_SLUG = {
  "skill.fabric": "fabric",
  "skill.fabric-archive": "fabric-archive",
  "skill.fabric-review": "fabric-review",
  // ADJ-NEWN-2 coverage fill: import + sync skills are delivered too.
  "skill.fabric-import": "fabric-import",
  "skill.fabric-sync": "fabric-sync",
  // ADJ-NEWN-1/#4: fabric-store knowledge-store ops skill.
  "skill.fabric-store": "fabric-store",
} as const;

// ADJ-NEWN-2: per-MCP-tool store-aware contract key, so each mcp capability row
// asserts ITS OWN contract exists (not a homogeneous "any contract" check).
const MCP_CONTRACT_KEY: Record<string, keyof typeof MCP_STORE_AWARE_CONTRACTS> = {
  "mcp.fab_recall": "fab_recall",
  "mcp.fab_plan_context": "fab_plan_context",
  "mcp.fab_get_knowledge_sections": "fab_get_knowledge_sections",
};

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
    client === "claudeCode" || client === "claudeCodeDesktop"
      ? join(target, ".claude/settings.json")
      : client === "codexCLI" || client === "codexDesktop"
        ? join(target, ".codex/hooks.json")
        : join(target, ".cursor/hooks.json");
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
    // Cursor reads .claude/.codex skills for back-compat; desktop variants
    // share their sibling CLI install surface.
    const probeDir = client === "cursor" ? ".claude" : dir;
    expect(
      existsSync(join(target, probeDir, "skills", slug, "SKILL.md")),
      `${cap.id}/${client}: skill (probe ${probeDir})`,
    ).toBe(true);
    return;
  }
  if (cap.surface === "mcp") {
    // ADJ-NEWN-2: assert THIS tool's own store-aware contract exists (per-tool,
    // not a homogeneous "any contract" check). Same MCP stdio surface serves all
    // all clients, so the contract presence is the per-client deliverable.
    const key = MCP_CONTRACT_KEY[cap.id];
    expect(key, `${cap.id}: no MCP_CONTRACT_KEY mapping`).toBeDefined();
    expect(
      MCP_STORE_AWARE_CONTRACTS[key as keyof typeof MCP_STORE_AWARE_CONTRACTS],
      `${cap.id}: store-aware contract for this tool`,
    ).toBeDefined();
    return;
  }
  if (cap.surface === "render") {
    // Bootstrap/render is delivered per client: Claude CLAUDE.md @-import,
    // Codex/Cursor managed blocks, all sourced from .fabric/AGENTS.md.
    const renderProbe: Record<ParityClient, string> = {
      claudeCode: "CLAUDE.md",
      claudeCodeDesktop: "CLAUDE.md",
      cursor: ".cursor/rules/fabric-bootstrap.mdc",
      codexCLI: "AGENTS.md",
      codexDesktop: "AGENTS.md",
    };
    expect(existsSync(join(target, renderProbe[client])), `${cap.id}/${client}: render`).toBe(true);
    return;
  }
}

describe("P5 — parity-matrix-driven client E2E (S14/S29)", () => {
  it("parity-matrix.json validates against the P0 schema", () => {
    expect(matrix.capabilities.length).toBeGreaterThan(0);
  });

  it("every (capability × supported client) cell is delivered by a fresh install", () => {
    const cells: Array<{ cap: string; client: string }> = [];
    for (const cap of matrix.capabilities) {
      for (const client of PARITY_CLIENTS) {
        if (cap.clients[client]?.supported === true) {
          assertDelivered(cap, client);
          cells.push({ cap: cap.id, client });
        }
      }
    }
    // Guard against an accidental empty sweep silently "passing".
    expect(cells.length).toBe(matrix.capabilities.length * PARITY_CLIENTS.length);
  });
});
