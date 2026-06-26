import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTranslator } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it, vi } from "vitest";

// W3-05 (ISS-033/034) — whoami / store / info-scope / sync / metrics must
// render in the project's configured fabric_language, not the OS env locale.
// We lock the zh-CN catalog for the new keys and verify the projectRoot-aware
// translator path end-to-end via the commands' null/empty branches.

const dirs: string[] = [];
const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalFabLang = process.env.FAB_LANG;
const originalFabricHome = process.env.FABRIC_HOME;

function zhProject(): string {
  const root = mkdtempSync(join(tmpdir(), "fab-i18n-cmd-"));
  dirs.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify({ fabric_language: "zh-CN" }),
    "utf8",
  );
  return root;
}

function isolateHome(): void {
  // No global Fabric config under an empty home → whoami()/scopeExplain() take
  // their null branch, which is exactly the localized line we assert. Isolate
  // via FABRIC_HOME (not by deleting it): resolveGlobalRoot() is fail-closed
  // under the test runner and throws when FABRIC_HOME is unset, so we point it
  // at the empty temp home — `<home>/.fabric` does not exist ⇒ same null branch.
  const home = mkdtempSync(join(tmpdir(), "fab-i18n-home-"));
  dirs.push(home);
  process.env.HOME = home;
  // grill-6fixes (D1): language is the single global tone in
  // ~/.fabric/fabric-global.json → `language`. With no global config present,
  // the projectRoot-aware translator resolves via the env fallback, so we drive
  // the expected zh-CN rendering through FAB_LANG.
  process.env.FAB_LANG = "zh-CN";
  process.env.FABRIC_HOME = home;
}

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalFabLang === undefined) delete process.env.FAB_LANG;
  else process.env.FAB_LANG = originalFabLang;
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("project-scoped command i18n", () => {
  it("zh-CN catalog renders Chinese for the new command keys", () => {
    const zh = createTranslator("zh-CN");
    const en = createTranslator("en");
    expect(zh("cli.cmd.no-global-config")).toMatch(/全局 Fabric 配置/);
    expect(en("cli.cmd.no-global-config")).toMatch(/no global Fabric config/);
    expect(zh("cli.store.none-mounted")).toMatch(/未挂载/);
    expect(zh("cli.store.detached")).toMatch(/已分离/);
    expect(zh("cli.sync.paused")).toMatch(/冲突暂停/);
    expect(zh("cli.metrics.no-activity")).toMatch(/无计数活动/);
    // placeholders survive translation
    expect(zh("cli.store.mounted", { alias: "x", count: "2" })).toContain("x");
    expect(zh("cli.store.mounted", { alias: "x", count: "2" })).toContain("2");
  });

  // ux-w1-6: the whoami alias was retired; `info --global` is the surviving
  // surface for global identity and carries the same i18n (ISS-033/034).
  it("info --global renders Chinese when fabric_language is zh-CN (ISS-033/034)", async () => {
    isolateHome();
    process.chdir(zhProject());
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.map(String).join(" "));
    });
    const infoCmd = (await import("../src/commands/info.ts")).default;
    await infoCmd.run?.({ args: { global: true } } as never);
    expect(logs.join("\n")).toMatch(/全局 Fabric 配置/);
  });

  // W3-F: scope-explain was retired into the `info scope` real subcommand; the
  // localized null-branch line is identical (same scopeExplain resolver).
  it("info scope renders Chinese when fabric_language is zh-CN", async () => {
    isolateHome();
    process.chdir(zhProject());
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.map(String).join(" "));
    });
    const infoCmd = (await import("../src/commands/info.ts")).default;
    const scopeCmd = (infoCmd.subCommands as Record<string, { run?: (ctx: never) => unknown }>).scope;
    await scopeCmd.run?.({ args: { coord: "team" } } as never);
    expect(logs.join("\n")).toMatch(/全局 Fabric 配置/);
  });
});
