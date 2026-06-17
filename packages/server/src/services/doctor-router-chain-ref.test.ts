import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import {
  createRouterChainRefCheck,
  inspectRouterChainRef,
} from "./doctor-skill-lints.js";

// B2 skill-router (A4): backstop lint for the fabric/ router S_CHAIN section.
// Producer-consumer round-trip (KT-PIT-0014): seed a real fabric/SKILL.md with
// a known-good / known-bad S_CHAIN, inspect, assert the lint fires only on a
// reference to a leaf NOT in the install set.

const tempDirs: string[] = [];
const t = createTranslator("en");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function seedRouter(sChain: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-router-chain-"));
  tempDirs.push(root);
  const dir = join(root, ".claude", "skills", "fabric");
  await mkdir(dir, { recursive: true });
  const body = [
    "---",
    "name: fabric",
    "description: router",
    "---",
    "",
    "# fabric",
    "",
    "### S_CHAIN",
    "",
    sChain,
    "",
    "## Guardrails",
    "",
    "- nothing here references fabric-* skills",
    "",
  ].join("\n");
  await writeFile(join(dir, "SKILL.md"), body, "utf8");
  return root;
}

describe("inspectRouterChainRef", () => {
  it("(ok) all S_CHAIN fabric-* refs are valid leaf skills", async () => {
    const root = await seedRouter(
      [
        "| 组合意图 | 顺序 |",
        "| --- | --- |",
        "| 同步后审 | `fabric-sync` -> `fabric-review` |",
        "| 审计处理 | `fabric-audit` -> `fabric-review` |",
        "| 找关联落盘 | `fabric-connect` -> `fabric-review` |",
      ].join("\n"),
    );

    const inspection = await inspectRouterChainRef(root);
    expect(inspection.status).toBe("ok");
    expect(inspection.unknownRefs).toEqual([]);

    const check = createRouterChainRefCheck(t, inspection);
    expect(check.status).toBe("ok");
  });

  it("(drift) an S_CHAIN ref to a non-install skill is flagged", async () => {
    const root = await seedRouter(
      [
        "| 组合意图 | 顺序 |",
        "| --- | --- |",
        "| 坏链 | `fabric-sync` -> `fabric-nonexistent` |",
        "| 又一坏链 | `fabric-ghost` -> `fabric-review` |",
      ].join("\n"),
    );

    const inspection = await inspectRouterChainRef(root);
    expect(inspection.status).toBe("drift");
    // sorted, deduped, only the unknown ones (valid fabric-sync/review excluded).
    expect(inspection.unknownRefs).toEqual(["fabric-ghost", "fabric-nonexistent"]);

    const check = createRouterChainRefCheck(t, inspection);
    expect(check.status).toBe("warn");
    expect(check.code).toBe("router_chain_ref_drift");
    expect(check.message).toContain("fabric-ghost");
    expect(check.message).toContain("fabric-nonexistent");
  });

  it("(no-op) absent router install is ok", async () => {
    const root = await mkdtemp(join(tmpdir(), "fabric-router-chain-empty-"));
    tempDirs.push(root);
    const inspection = await inspectRouterChainRef(root);
    expect(inspection.status).toBe("ok");
  });

  it("(no-op) router without an S_CHAIN section is ok", async () => {
    const root = await mkdtemp(join(tmpdir(), "fabric-router-chain-nochain-"));
    tempDirs.push(root);
    const dir = join(root, ".codex", "skills", "fabric");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: fabric\n---\n\n# fabric\n\n## Guardrails\n", "utf8");
    const inspection = await inspectRouterChainRef(root);
    expect(inspection.status).toBe("ok");
  });
});
