import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupFixtureRoot, createWerewolfFixtureRoot } from "./helpers/init-test-utils.ts";

/**
 * G1 (ralph-v2-20260709) → ISS-20260713-058:
 * 新装用户默认 nudge_mode = "minimal" — 每会话一条 human trust-anchor 状态行
 * (非 AI-only 静音)。原 G1 选 "silent" 但装完无披露,用户误以为 "Fabric 没生效",
 * 故改默认为 "minimal"。AI sink 两种模式都不受影响。
 *
 * 老用户 config 不动(scaffold 是 idempotent,不覆写现有文件 — 由
 * install-cli-surface.test.ts 的 preserve/reapply case 保证)。
 * 这里只锁"新装的 fresh 默认必为 minimal"。
 */
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("install-scaffold nudge_mode default (G1 → ISS-20260713-058)", () => {
  it("writes nudge_mode: 'minimal' when scaffolding a fresh .fabric/fabric-config.json", async () => {
    const target = createWerewolfFixtureRoot("fab-init-nudge-minimal-default");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const configPath = join(target, ".fabric", "fabric-config.json");
    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;

    expect(parsed).toHaveProperty("nudge_mode");
    expect(parsed.nudge_mode).toBe("minimal");
  });

  it("scaffolded value survives round-trip parse (byte-level check)", async () => {
    const target = createWerewolfFixtureRoot("fab-init-nudge-minimal-byte");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const raw = readFileSync(join(target, ".fabric", "fabric-config.json"), "utf8");
    // 直接抓 JSON 里的 nudge_mode:"minimal" 字节序,防实现被改成 nudge_mode:null + 运行时兜底
    expect(raw).toContain('"nudge_mode": "minimal"');
    expect(raw).not.toContain('"nudge_mode": "normal"');
  });
});
