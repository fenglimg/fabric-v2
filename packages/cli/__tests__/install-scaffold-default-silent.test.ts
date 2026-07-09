import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupFixtureRoot, createWerewolfFixtureRoot } from "./helpers/init-test-utils.ts";

/**
 * G1 (ralph-v2-20260709 / GRL-STOPHOOK-AIONLY-20260709):
 * 新装用户默认 nudge_mode = "silent" — AI-only 可见、人静音兜底。
 *
 * 老用户 config 不动(scaffold 是 idempotent,不覆写现有文件 — 由
 * install-cli-surface.test.ts 的 preserve/reapply case 保证)。
 * 这里只锁"新装的 fresh 默认必为 silent"。
 */
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("install-scaffold nudge_mode default (G1)", () => {
  it("writes nudge_mode: 'silent' when scaffolding a fresh .fabric/fabric-config.json", async () => {
    const target = createWerewolfFixtureRoot("fab-init-nudge-silent-default");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const configPath = join(target, ".fabric", "fabric-config.json");
    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;

    expect(parsed).toHaveProperty("nudge_mode");
    expect(parsed.nudge_mode).toBe("silent");
  });

  it("scaffolded value survives round-trip parse (byte-level check)", async () => {
    const target = createWerewolfFixtureRoot("fab-init-nudge-silent-byte");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const raw = readFileSync(join(target, ".fabric", "fabric-config.json"), "utf8");
    // 直接抓 JSON 里的 nudge_mode:"silent" 字节序,防实现被改成 nudge_mode:null + 运行时兜底
    expect(raw).toContain('"nudge_mode": "silent"');
    expect(raw).not.toContain('"nudge_mode": "normal"');
  });
});
