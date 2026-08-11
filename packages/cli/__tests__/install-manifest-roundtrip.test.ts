import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  INSTALL_MANIFEST_REL,
  diffInstallManifest,
  hashInstalledFile,
  parseInstallManifest,
} from "@fenglimg/fabric-shared";

import { installArchiveHintHook } from "../src/install/install-hook-scripts.ts";
import { installFabricStoreSkill } from "../src/install/install-skills.ts";
import { buildInstallManifest, writeInstallManifest } from "../src/install/write-install-manifest.ts";

// Producer-consumer round-trip: `fabric install` is the PRODUCER of the
// manifest and `fabric doctor` is the CONSUMER. Checking the writer alone is
// false-green — a manifest that serializes fine but does not parse back through
// `parseInstallManifest` makes doctor silently report "no manifest", i.e. the
// drift check quietly does nothing forever. So every assertion below goes
// through the same reader the server uses.

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "manifest-"));
  roots.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  return root;
}

function readManifest(root: string) {
  const raw = readFileSync(join(root, ...INSTALL_MANIFEST_REL.split("/")), "utf8");
  return parseInstallManifest(raw);
}

/** Install a real skill + hook so the manifest has genuine artifacts to cover. */
async function installSome(root: string): Promise<void> {
  await installFabricStoreSkill(root);
  await installArchiveHintHook(root);
}

describe("install manifest round-trip", () => {
  it("writes a manifest the server's parser accepts", async () => {
    const root = makeRoot();
    await installSome(root);

    const rel = await writeInstallManifest(root);

    expect(rel).toBe(INSTALL_MANIFEST_REL);
    const parsed = readManifest(root);
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!.files).length).toBeGreaterThan(0);
  });

  it("covers the skills and hooks install actually wrote", async () => {
    const root = makeRoot();
    await installSome(root);

    await writeInstallManifest(root);
    const tracked = new Set(Object.keys(readManifest(root)!.files));

    for (const rel of [
      ".claude/skills/fabric-store/SKILL.md",
      ".codex/skills/fabric-store/SKILL.md",
      ".claude/hooks/fabric-hint.cjs",
      ".codex/hooks/fabric-hint.cjs",
    ]) {
      expect(tracked, `${rel} was installed but the manifest does not vouch for it`).toContain(rel);
    }
  });

  // Hook configs are deep-MERGED into a user's own file, so their bytes are
  // supposed to differ from anything we shipped. Tracking them would make every
  // healthy install report drift the moment the user adds their own hook.
  it("excludes the merged client hook configs", async () => {
    const root = makeRoot();
    await installSome(root);

    await writeInstallManifest(root);
    const tracked = Object.keys(readManifest(root)!.files);

    expect(tracked).not.toContain(".claude/settings.json");
    expect(tracked).not.toContain(".codex/hooks.json");
  });

  it("records hashes that match the bytes on disk, via the server's own differ", async () => {
    const root = makeRoot();
    await installSome(root);
    await writeInstallManifest(root);

    const manifest = readManifest(root)!;
    const actual: Record<string, string> = {};
    for (const rel of Object.keys(manifest.files)) {
      actual[rel] = hashInstalledFile(readFileSync(join(root, ...rel.split("/"))));
    }

    expect(diffInstallManifest(manifest, actual)).toEqual([]);
  });

  it("a hand-edited installed copy shows up as drift", async () => {
    const root = makeRoot();
    await installSome(root);
    await writeInstallManifest(root);
    const manifest = readManifest(root)!;

    const edited = ".claude/hooks/fabric-hint.cjs";
    const actual: Record<string, string> = {};
    for (const rel of Object.keys(manifest.files)) {
      const content = rel === edited ? "tampered\n" : readFileSync(join(root, ...rel.split("/")));
      actual[rel] = hashInstalledFile(content);
    }

    expect(diffInstallManifest(manifest, actual)).toEqual([{ path: edited, kind: "modified" }]);
  });

  it("uses POSIX-shaped keys so the paths compare stably across platforms", async () => {
    const root = makeRoot();
    await installSome(root);

    const manifest = await buildInstallManifest(root);

    for (const key of Object.keys(manifest.files)) {
      expect(key).not.toContain("\\");
      expect(key.startsWith("/")).toBe(false);
    }
  });

  it("re-running install rewrites a manifest that still verifies", async () => {
    const root = makeRoot();
    await installSome(root);
    await writeInstallManifest(root);
    const first = readManifest(root)!;

    await installSome(root);
    await writeInstallManifest(root);
    const second = readManifest(root)!;

    // Idempotent install → identical file hashes (generated_at may differ).
    expect(second.files).toEqual(first.files);
  });

  it("omits rather than fabricates an entry for a file it cannot read", async () => {
    const root = makeRoot();
    await installSome(root);
    // A skill dir whose SKILL.md never landed: the manifest must not claim it.
    const ghost = join(root, ".claude", "skills", "fabric-store", "SKILL.md");
    rmSync(ghost);

    const manifest = await buildInstallManifest(root);

    expect(Object.keys(manifest.files)).not.toContain(".claude/skills/fabric-store/SKILL.md");
    expect(Object.keys(manifest.files)).toContain(".codex/skills/fabric-store/SKILL.md");
  });

  it("never throws when the project root cannot take a manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "manifest-nofabric-"));
    roots.push(root);
    // No .fabric/ directory — the write must fail soft, not blow up install.
    expect(await writeInstallManifest(root)).toBeNull();
  });

  it("survives a project with nothing installed at all", async () => {
    const root = makeRoot();

    const manifest = await buildInstallManifest(root);

    expect(manifest.files).toEqual({});
    expect(diffInstallManifest(manifest, {})).toEqual([]);
  });
});

describe("manifest write is wired into the install pipeline", () => {
  // The unit above proves the writer works; this proves someone calls it.
  // A correct-but-uncalled writer is the exact shape of I1 (the recall-playbook
  // ref files), so the wiring gets its own assertion.
  it("ValidateStage writes the manifest", async () => {
    const { ValidateStage } = await import("../src/install/pipeline/validate.stage.ts");
    const root = makeRoot();
    await installSome(root);
    writeFileSync(join(root, ".fabric", "fabric-config.json"), "{}\n", "utf8");
    writeFileSync(join(root, ".fabric", "events.jsonl"), "", "utf8");

    await new ValidateStage().execute({
      target: root,
      options: {},
    } as unknown as Parameters<InstanceType<typeof ValidateStage>["execute"]>[0]);

    expect(readManifest(root)).not.toBeNull();
  });
});
