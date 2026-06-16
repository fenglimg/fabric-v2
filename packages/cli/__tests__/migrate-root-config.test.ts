import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateRootConfig } from "../src/install/migrate-root-config.js";

// A1 (KT-DEC-0003): the legacy project-root fabric.config.json is folded into
// .fabric/fabric-config.json so there is one config source of truth. These tests
// pin the merge rule — most importantly that a user's explicit root embed_enabled
// is never silently reverted to the scaffolded .fabric default.
describe("migrateRootConfig (A1 — config single source of truth)", () => {
  let projectRoot: string;
  const rootPath = (): string => join(projectRoot, "fabric.config.json");
  const fabricPath = (): string => join(projectRoot, ".fabric", "fabric-config.json");

  beforeEach(() => {
    projectRoot = join(tmpdir(), `fabric-migrate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const writeRoot = (obj: unknown): void => writeFileSync(rootPath(), JSON.stringify(obj));
  const writeFabric = (obj: unknown): void => writeFileSync(fabricPath(), JSON.stringify(obj));
  const readFabric = (): Record<string, unknown> => JSON.parse(readFileSync(fabricPath(), "utf8"));

  it("no-ops when there is no legacy root file", () => {
    writeFabric({ default_layer_filter: "both" });
    const result = migrateRootConfig(projectRoot);
    expect(result.migrated).toBe(false);
    expect(readFabric()).toEqual({ default_layer_filter: "both" });
  });

  it("root wins for embed_enabled — the user's explicit enable is preserved, not reverted", () => {
    writeFabric({ embed_enabled: false, default_layer_filter: "both" });
    writeRoot({ embed_enabled: true, embed_model: "fast-bge-small-zh-v1.5" });

    const result = migrateRootConfig(projectRoot);

    expect(result.migrated).toBe(true);
    const merged = readFabric();
    expect(merged.embed_enabled).toBe(true); // ROOT_AUTHORITATIVE → root wins
    expect(merged.embed_model).toBe("fast-bge-small-zh-v1.5"); // carried over
    expect(merged.default_layer_filter).toBe("both"); // .fabric value kept
    expect(existsSync(rootPath())).toBe(false); // legacy root file removed
  });

  it(".fabric wins for panel-managed keys (default_layer_filter)", () => {
    writeFabric({ default_layer_filter: "team" });
    writeRoot({ default_layer_filter: "personal" });

    migrateRootConfig(projectRoot);

    expect(readFabric().default_layer_filter).toBe("team"); // panel key — .fabric wins
  });

  it("carries over root keys absent from .fabric", () => {
    writeFabric({ default_layer_filter: "both" });
    writeRoot({ plan_context_top_k: 42 });

    migrateRootConfig(projectRoot);

    expect(readFabric().plan_context_top_k).toBe(42);
  });

  it("removes a corrupt/unreadable legacy root file (nothing to merge, but root is dead weight)", () => {
    writeFabric({ default_layer_filter: "both" });
    writeFileSync(rootPath(), "{ not json");

    const result = migrateRootConfig(projectRoot);

    expect(result.migrated).toBe(true);
    expect(existsSync(rootPath())).toBe(false);
    expect(readFabric()).toEqual({ default_layer_filter: "both" }); // .fabric untouched
  });
});
