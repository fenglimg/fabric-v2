// W2-04 (F6): Codex CLI `installedCapabilities.skill` was hardcoded `false`
// with a stale comment, so `fabric install` always reported Codex skills as
// uninstalled — even right after installing them. It must probe the real
// `.codex/skills/` directory (mirroring the `.codex/hooks.json` hook probe).
// Cursor similarly supports Fabric hooks through `.cursor/hooks.json`, but has
// no first-class Skills directory in Fabric's install surface.
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
  it("advertises hook support but not first-class skill support", () => {
    const root = tmp();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    const cursor = cursorEntry(root);
    expect(cursor?.capabilities.hook).toBe(true);
    expect(cursor?.capabilities.skill).toBe(false);
    expect(cursor?.installedCapabilities?.skill).toBe(false);
  });

  it("reports hook=true once .cursor/hooks.json exists", () => {
    const root = tmp();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    expect(cursorEntry(root)?.installedCapabilities?.hook).toBe(false);
    writeFileSync(join(root, ".cursor", "hooks.json"), "{}\n");
    expect(cursorEntry(root)?.installedCapabilities?.hook).toBe(true);
  });
});
