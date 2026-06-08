// W2-04 (F6): Codex CLI `installedCapabilities.skill` was hardcoded `false`
// with a stale comment, so `fabric install` always reported Codex skills as
// uninstalled — even right after installing them. It must probe the real
// `.codex/skills/` directory (mirroring the `.codex/hooks.json` hook probe).
// Cursor and Codex Desktop support Fabric skills through shared install
// surfaces: Cursor reads the Claude/Codex skill trees, while Codex Desktop
// shares the `.codex` surface with Codex CLI.
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
function cursorEntry(root: string) {
  return detectClientSupports(root).find((c) => c.clientKind === "Cursor");
}
function codexDesktopEntry(root: string) {
  return detectClientSupports(root).find((c) => c.clientKind === "CodexDesktop");
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

describe("Cursor hook capability probe", () => {
  it("advertises hook and skill support through shared skill trees", () => {
    const root = tmp();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    const cursor = cursorEntry(root);
    expect(cursor?.capabilities.hook).toBe(true);
    expect(cursor?.capabilities.skill).toBe(true);
    expect(cursor?.installedCapabilities?.skill).toBe(false);
  });

  it("reports skill=true once a shared Claude or Codex skill tree exists", () => {
    const root = tmp();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    mkdirSync(join(root, ".codex", "skills", "fabric"), { recursive: true });
    expect(cursorEntry(root)?.installedCapabilities?.skill).toBe(true);
  });

  it("reports hook=true once .cursor/hooks.json exists", () => {
    const root = tmp();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    expect(cursorEntry(root)?.installedCapabilities?.hook).toBe(false);
    writeFileSync(join(root, ".cursor", "hooks.json"), "{}\n");
    expect(cursorEntry(root)?.installedCapabilities?.hook).toBe(true);
  });
});

describe("Codex Desktop shared surface probe", () => {
  it("uses the Codex install surface for hook and skill status", () => {
    const root = tmp();
    mkdirSync(join(root, ".codex", "skills", "fabric"), { recursive: true });
    writeFileSync(join(root, ".codex", "hooks.json"), "{}\n");

    const desktop = codexDesktopEntry(root);
    expect(desktop?.label).toBe("Codex Desktop");
    expect(desktop?.capabilities.mcp).toBe(true);
    expect(desktop?.capabilities.hook).toBe(true);
    expect(desktop?.capabilities.skill).toBe(true);
    expect(desktop?.installedCapabilities?.hook).toBe(true);
    expect(desktop?.installedCapabilities?.skill).toBe(true);
  });
});
