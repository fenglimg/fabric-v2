import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupFixtureRoot, createWerewolfFixtureRoot } from "./helpers/init-test-utils.ts";
import { GLOBAL_POLICY_DEFAULTS } from "../src/install/install-scaffold-config.ts";

/**
 * G1 (ralph-v2-20260709) → ISS-20260713-058:
 * 新装用户默认 nudge_mode = "minimal" — 每会话一条 human trust-anchor 状态行
 * (非 AI-only 静音)。原 G1 选 "silent" 但装完无披露,用户误以为 "Fabric 没生效",
 * 故改默认为 "minimal"。AI sink 两种模式都不受影响。
 *
 * config-single-home W5: 这条产品意图不变,但 nudge_mode 是 PREFERENCE 类旋钮,
 * 它的家已从 repo 的 fabric-config.json 迁到 `~/.fabric/fabric-global.json` 的
 * `defaults`。repo 侧只剩身份,scaffold 再写策略键只会种出 doctor 要报的失效残留。
 *
 * 老用户 config 不动(scaffold 幂等,不覆写现有文件 — 由
 * install-cli-surface.test.ts 的 preserve/reapply case 保证)。
 */
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("install-scaffold nudge_mode default (G1 → ISS-20260713-058)", () => {
  it("ships nudge_mode: 'minimal' as a GLOBAL policy default", () => {
    // The shipped default is declared once, in the global policy seed — that is
    // what `install --global` writes into fabric-global.json → defaults.
    expect(GLOBAL_POLICY_DEFAULTS.nudge_mode).toBe("minimal");
  });

  it("does NOT scaffold policy knobs into the repo config (identity-only)", async () => {
    const target = createWerewolfFixtureRoot("fab-init-nudge-minimal-default");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const configPath = join(target, ".fabric", "fabric-config.json");
    // The file must still EXIST — it is the upward marker ProjectRootResolver
    // searches for — but it must not carry policy.
    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty("nudge_mode");
    for (const key of Object.keys(GLOBAL_POLICY_DEFAULTS)) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it("scaffolds no stale nudge_mode bytes into the repo config", async () => {
    const target = createWerewolfFixtureRoot("fab-init-nudge-minimal-byte");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const raw = readFileSync(join(target, ".fabric", "fabric-config.json"), "utf8");
    expect(raw).not.toContain("nudge_mode");
  });
});
