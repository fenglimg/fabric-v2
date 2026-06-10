// W2-04 (F6): Codex CLI `installedCapabilities.skill` was hardcoded `false`
// with a stale comment, so `fabric install` always reported Codex skills as
// uninstalled — even right after installing them. It must probe the real
// `.codex/skills/` directory (mirroring the `.codex/hooks.json` hook probe).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectClientSupports } from "../src/config/resolver.ts";

const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "fabric-resolver-"));
  tempDirs.push(d);
  return d;
}
function codexEntry(root: string) {
  return detectClientSupports(root).find((c) => c.clientKind === "CodexCLI");
}

describe("Codex installedCapabilities.skill probe (F6)", () => {
  it("reports skill=false when .codex/skills is absent", () => {
    const root = tmp();
    expect(codexEntry(root)?.installedCapabilities?.skill).toBe(false);
  });

  it("reports skill=true once .codex/skills exists (skills installed)", () => {
    const root = tmp();
    mkdirSync(join(root, ".codex", "skills", "fabric-archive"), { recursive: true });
    expect(codexEntry(root)?.installedCapabilities?.skill).toBe(true);
  });
});

// C2: Cursor genuinely receives Fabric hooks (hooks-orchestrator writes
// `.cursor/hooks/` + `.cursor/hooks.json`) AND has skills available — Cursor
// resolves Skills from the `.claude` / `.codex` dirs (cross-client fallback)
// that install populates, so no `.cursor/skills` write is needed. Both
// capabilities are therefore true; the prior `false` flags under-reported them.
describe("Cursor hook + skill capability (real installer delivers both)", () => {
  function cursorEntry(root: string) {
    return detectClientSupports(root).find((c) => c.clientKind === "Cursor");
  }
  it("advertises capabilities.hook=true", () => {
    expect(cursorEntry(tmp())?.capabilities.hook).toBe(true);
  });
  it("advertises capabilities.skill=true (reads skills from .claude/.codex dirs)", () => {
    expect(cursorEntry(tmp())?.capabilities.skill).toBe(true);
  });
  it("installedCapabilities.hook reflects .cursor/hooks.json presence", () => {
    const root = tmp();
    expect(cursorEntry(root)?.installedCapabilities?.hook).toBe(false);
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(join(root, ".cursor", "hooks.json"), "{}");
    expect(cursorEntry(root)?.installedCapabilities?.hook).toBe(true);
  });
  it("installedCapabilities.skill reflects shared .claude/.codex skill dirs", () => {
    const root = tmp();
    expect(cursorEntry(root)?.installedCapabilities?.skill).toBe(false);
    mkdirSync(join(root, ".codex", "skills", "fabric-archive"), { recursive: true });
    expect(cursorEntry(root)?.installedCapabilities?.skill).toBe(true);
  });
});

// C2: Codex Desktop shares ~/.codex with Codex CLI — no separate adapter. It is
// a display-only capability row that mirrors Codex CLI's installed state.
describe("Codex Desktop display row (shares ~/.codex with Codex CLI)", () => {
  function desktop(root: string) {
    return detectClientSupports(root).find((c) => c.clientKind === "CodexDesktop");
  }
  it("is present and advertises bootstrap+mcp+hook+skill", () => {
    expect(desktop(tmp())?.capabilities).toMatchObject({
      bootstrap: true,
      mcp: true,
      hook: true,
      skill: true,
    });
  });
  it("mirrors Codex CLI installed-skill state via .codex/skills probe", () => {
    const root = tmp();
    expect(desktop(root)?.installedCapabilities?.skill).toBe(false);
    mkdirSync(join(root, ".codex", "skills", "fabric-archive"), { recursive: true });
    expect(desktop(root)?.installedCapabilities?.skill).toBe(true);
  });
});
