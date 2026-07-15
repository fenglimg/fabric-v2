import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema, storeRelativePathForMount } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { storeDoctorChecks } from "../src/store/doctor-checks.js";
import { fixActivePersonalPointer } from "../src/store/store-ops.js";
import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";

// v2.1.0-rc.1 P3 — doctor multi-store health checks (S10/S51/R5#5).

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSONAL2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Materialize on-disk mount roots so first-hit store_unreachable does not fire. */
function ensureStoreDirs(
  globalRoot: string,
  stores: Array<{ store_uuid: string; mount_name?: string; personal?: boolean }>,
): void {
  for (const store of stores) {
    mkdirSync(join(globalRoot, storeRelativePathForMount(store), "knowledge"), {
      recursive: true,
    });
  }
}

/** Seed one canonical knowledge markdown so first-hit does not report empty_store. */
function seedStoreEntry(
  globalRoot: string,
  store: { store_uuid: string; mount_name?: string },
): void {
  const dir = join(globalRoot, storeRelativePathForMount(store), "knowledge", "guidelines");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "KT-GLD-0001--seed.md"),
    "---\nid: KT-GLD-0001\ntype: guidelines\n---\nseed\n",
    "utf8",
  );
}

/** Install the two client hooks first-hit probes for so it does not report hooks_missing. */
function installHooks(projectRoot: string): void {
  const hooksDir = join(projectRoot, ".claude", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(join(hooksDir, "knowledge-hint-broad.cjs"), "// session-start hook\n", "utf8");
  writeFileSync(join(hooksDir, "knowledge-pretooluse.cjs"), "// pre-tool-use hook\n", "utf8");
}

describe("doctor store checks", () => {
  it("warns when no global config exists", () => {
    const diags = storeDoctorChecks(tmp("dr-proj-"), join(tmp("dr-g-"), ".fabric"));
    expect(diags).toEqual([expect.objectContaining({ code: "no_global_config", severity: "warn" })]);
  });

  it("warns on a missing required store and nudges a local-only store", () => {
    const globalRoot = join(tmp("dr-g2-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team" }, // local-only (no remote)
        ],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-p2-");
    saveProjectConfig(
      { project_id: "11111111-1111-4111-8111-111111111111", required_stores: [{ id: "platform" }] },
      projectRoot,
    );

    const diags = storeDoctorChecks(projectRoot, globalRoot);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("missing_required_store"); // platform not mounted
    expect(codes).toContain("local_only_store"); // team has no remote
    // personal store (no remote) does NOT trigger the local-only nudge.
    expect(diags.filter((d) => d.code === "local_only_store").map((d) => d.ref)).toEqual(["team"]);
  });

  it("is clean when everything is mounted with remotes", () => {
    const globalRoot = join(tmp("dr-g3-"), ".fabric");
    const stores = [
      { store_uuid: PERSONAL, alias: "personal", personal: true as const },
      { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
    ];
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores,
      }),
      globalRoot,
    );
    // Registry alone is not enough: first-hit store_unreachable checks on-disk dirs.
    ensureStoreDirs(globalRoot, stores);
    // D3 first-hit (wired into doctor since 145551be): a genuinely clean project
    // must also carry ≥1 knowledge entry on its read-set, else first-hit reports
    // empty_store. Seed one canonical entry into the team store tree.
    seedStoreEntry(globalRoot, { store_uuid: TEAM });
    const projectRoot = tmp("dr-p3-");
    // ...and the client hooks must be installed, else first-hit reports
    // hooks_missing. Materialize the two hooks first-hit probes for.
    installHooks(projectRoot);
    saveProjectConfig(
      {
        project_id: "11111111-1111-4111-8111-111111111111",
        required_stores: [{ id: "team" }],
        // D3 first-hit: a genuinely clean project must name a write target,
        // else first-hit reports no_write_target (surfaced as a warn diag).
        active_write_store: "team",
      },
      projectRoot,
    );
    expect(storeDoctorChecks(projectRoot, globalRoot)).toEqual([]);
  });

  it("warns first_hit_store_unreachable when a bound store dir is missing on disk", () => {
    const globalRoot = join(tmp("dr-g-unr-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
        ],
      }),
      globalRoot,
    );
    // Intentionally no ensureStoreDirs — registry only.
    const projectRoot = tmp("dr-p-unr-");
    saveProjectConfig(
      {
        project_id: "11111111-1111-4111-8111-111111111111",
        required_stores: [{ id: "team" }],
        active_write_store: "team",
      },
      projectRoot,
    );
    const diags = storeDoctorChecks(projectRoot, globalRoot);
    const unr = diags.find((d) => d.code === "first_hit_store_unreachable");
    expect(unr?.severity).toBe("warn");
    expect(unr?.ref).toMatch(/team/);
  });

  it("nudges (info) a mounted store the project has not bound, never personal", () => {
    const globalRoot = join(tmp("dr-g5-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
        ],
      }),
      globalRoot,
    );
    // Project declares NO required stores → team is mounted-but-unbound.
    const projectRoot = tmp("dr-p5-");
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);

    const diags = storeDoctorChecks(projectRoot, globalRoot);
    const unbound = diags.filter((d) => d.code === "unbound_available_store");
    expect(unbound.map((d) => d.ref)).toEqual(["team"]); // personal excluded
    expect(unbound[0]?.severity).toBe("info");
  });

  it("warns when a mounted store smuggles an executable/hook file (S65 RCE defense)", () => {
    const globalRoot = join(tmp("dr-g4-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [{ store_uuid: TEAM, alias: "team", remote: "git@h:team.git" }],
      }),
      globalRoot,
    );
    // Plant an executable hook inside the on-disk store tree.
    const storeDir = join(globalRoot, storeRelativePathForMount({ store_uuid: TEAM }));
    mkdirSync(join(storeDir, "hooks"), { recursive: true });
    writeFileSync(join(storeDir, "hooks", "evil.cjs"), "console.log('rce')\n", "utf8");

    const projectRoot = tmp("dr-p4-");
    saveProjectConfig(
      { project_id: "11111111-1111-4111-8111-111111111111", required_stores: [{ id: "team" }] },
      projectRoot,
    );
    const diags = storeDoctorChecks(projectRoot, globalRoot);
    const exec = diags.find((d) => d.code === "executable_in_store");
    expect(exec).toBeDefined();
    expect(exec?.severity).toBe("warn");
    expect(exec?.ref).toBe("team");
  });

  // 语义 A (multi-personal): active_personal_store pointer integrity lints.
  it("errors when active_personal_store points at a non-personal store", () => {
    const globalRoot = join(tmp("dr-ap1-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        active_personal_store: "team",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
        ],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-ap1p-");
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);
    const diag = storeDoctorChecks(projectRoot, globalRoot).find(
      (d) => d.code === "active_personal_invalid",
    );
    expect(diag?.severity).toBe("error");
    expect(diag?.ref).toBe("team");
  });

  it("info-nudges when ≥2 personal stores are mounted but none is active", () => {
    const globalRoot = join(tmp("dr-ap2-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: PERSONAL2, alias: "personal-work", personal: true },
        ],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-ap2p-");
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);
    const diag = storeDoctorChecks(projectRoot, globalRoot).find(
      (d) => d.code === "active_personal_unset",
    );
    expect(diag?.severity).toBe("info");
  });

  it("is silent for a single personal store with no active pointer", () => {
    const globalRoot = join(tmp("dr-ap3-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [{ store_uuid: PERSONAL, alias: "personal", personal: true }],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-ap3p-");
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);
    const codes = storeDoctorChecks(projectRoot, globalRoot).map((d) => d.code);
    expect(codes).not.toContain("active_personal_invalid");
    expect(codes).not.toContain("active_personal_unset");
  });

  it("--fix rewrites a dangling active pointer to the first personal store", async () => {
    const globalRoot = join(tmp("dr-ap4-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        active_personal_store: "team",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
        ],
      }),
      globalRoot,
    );
    await expect(fixActivePersonalPointer(globalRoot)).resolves.toBe(true);
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe("personal");
  });

  it("--fix sets the active pointer to the first personal when unset with ≥2 personal", async () => {
    const globalRoot = join(tmp("dr-ap5-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: PERSONAL2, alias: "personal-work", personal: true },
        ],
      }),
      globalRoot,
    );
    await expect(fixActivePersonalPointer(globalRoot)).resolves.toBe(true);
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe("personal");
  });

  it("--fix is a no-op (returns false) when the pointer is already valid", async () => {
    const globalRoot = join(tmp("dr-ap6-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        active_personal_store: "personal-work",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: PERSONAL2, alias: "personal-work", personal: true },
        ],
      }),
      globalRoot,
    );
    await expect(fixActivePersonalPointer(globalRoot)).resolves.toBe(false);
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe("personal-work");
  });
});

// D4-2: quality remediations must route operators to fab_review / fabric-review
// (draft backlog promote + consumption-zero / retire candidates).
describe("doctor quality remediations route to fab_review", () => {
  it("pins ≥2 quality remediations that name fab_review or fabric-review", () => {
    // Source locales (not runtime t()) — hermetic, no i18n bootstrap required.
    const enPath = join(
      process.cwd(),
      "../shared/src/i18n/locales/en.ts",
    );
    const zhPath = join(
      process.cwd(),
      "../shared/src/i18n/locales/zh-CN.ts",
    );
    const en = readFileSync(enPath, "utf8");
    const zh = readFileSync(zhPath, "utf8");

    const requiredKeys = [
      "doctor.check.draft_backlog.remediation",
      "doctor.store.consumption-zero",
    ] as const;

    for (const key of requiredKeys) {
      expect(en, `en missing ${key}`).toContain(key);
      expect(zh, `zh missing ${key}`).toContain(key);
    }

    // draft backlog → fabric-review promote path
    expect(en).toMatch(
      /"doctor\.check\.draft_backlog\.remediation":\s*\n?\s*"[^"]*(?:fabric-review|fab_review)[^"]*"/u,
    );
    // zero-consumption → fab_review retirement signal
    expect(en).toMatch(
      /"doctor\.store\.consumption-zero":\s*"[^"]*(?:fabric-review|fab_review)[^"]*"/u,
    );

    // zh mirrors review intent (fabric-review or fab_review)
    expect(zh).toMatch(/doctor\.check\.draft_backlog\.remediation[\s\S]{0,200}(?:fabric-review|fab_review)/u);
    expect(zh).toMatch(/doctor\.store\.consumption-zero[\s\S]{0,200}(?:fabric-review|fab_review)/u);
  });
});
