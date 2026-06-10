import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deriveMountLabel,
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  STORE_MOUNT_NAME_PATTERN,
  STORES_ROOT_DIR,
  storeMountGroup,
  storeMountSubPath,
  storeRelativePathForMount,
} from "../../src/schemas/store.js";
import { initStore } from "../../src/store/core.js";
import { cleanupTestWall, createIsolatedHome } from "../helpers/test-wall.js";

// grill ④ — two-layer store layout `stores/<group>/<label>/`. The group bucket
// (personal|team) is derived from the `personal:true` flag, NOT baked into the
// directory name; the label is a remote-derived human tag, never the identity.

afterEach(() => {
  cleanupTestWall();
});

const UUID = "a2bec02a-6bac-4e1d-9c38-8a6bd327fd7f";

describe("storeMountGroup (group derives from personal flag, not the dir name)", () => {
  it("personal:true → personal bucket", () => {
    expect(storeMountGroup({ personal: true })).toBe("personal");
  });
  it("personal:false / absent → team bucket", () => {
    expect(storeMountGroup({ personal: false })).toBe("team");
    expect(storeMountGroup({})).toBe("team");
  });
});

describe("storeMountSubPath / storeRelativePathForMount (two-layer)", () => {
  it("composes <group>/<label> from personal + mount_name", () => {
    expect(storeMountSubPath({ store_uuid: UUID, mount_name: "platform-kb", personal: false })).toBe(
      "team/platform-kb",
    );
    expect(storeMountSubPath({ store_uuid: UUID, mount_name: "my-kb", personal: true })).toBe(
      "personal/my-kb",
    );
  });

  it("storeRelativePathForMount roots the subpath under STORES_ROOT_DIR", () => {
    expect(storeRelativePathForMount({ store_uuid: UUID, mount_name: "team-kb" })).toBe(
      `${STORES_ROOT_DIR}/team/team-kb`,
    );
    expect(
      storeRelativePathForMount({ store_uuid: UUID, mount_name: "team-kb", personal: true }),
    ).toBe(`${STORES_ROOT_DIR}/personal/team-kb`);
  });

  it("falls back to the full store_uuid as the label when mount_name is absent", () => {
    expect(storeRelativePathForMount({ store_uuid: UUID })).toBe(`${STORES_ROOT_DIR}/team/${UUID}`);
  });
});

describe("deriveMountLabel (remote repo name → alias → short uuid; always pattern-valid)", () => {
  it("derives the repo name from an https remote, stripping .git", () => {
    expect(
      deriveMountLabel({ remote: "https://github.com/fenglimg/fabric-team-knowledge.git", store_uuid: UUID }),
    ).toBe("fabric-team-knowledge");
    expect(
      deriveMountLabel({ remote: "https://github.com/fenglimg/fabric-store-personal-pcf", store_uuid: UUID }),
    ).toBe("fabric-store-personal-pcf");
  });

  it("handles scp-style git@host:org/repo.git remotes", () => {
    expect(deriveMountLabel({ remote: "git@github.com:org/My_Repo.git", store_uuid: UUID })).toBe(
      "my_repo",
    );
  });

  it("ignores a trailing slash on the remote", () => {
    expect(deriveMountLabel({ remote: "https://example.com/org/team-kb/", store_uuid: UUID })).toBe(
      "team-kb",
    );
  });

  it("falls back to the alias when there is no remote", () => {
    expect(deriveMountLabel({ alias: "personal", store_uuid: UUID })).toBe("personal");
  });

  it("falls back to the short uuid when neither remote nor a usable alias exists", () => {
    expect(deriveMountLabel({ store_uuid: UUID })).toBe("a2bec02a");
    // An alias that sanitizes to nothing usable also falls through to the uuid.
    expect(deriveMountLabel({ alias: "..", store_uuid: UUID })).toBe("a2bec02a");
  });

  it("always returns a STORE_MOUNT_NAME_PATTERN-valid label", () => {
    for (const remote of [
      "https://github.com/fenglimg/fabric-team-knowledge.git",
      "git@github.com:org/Weird..Name--x.git",
      "https://h/org/UPPER_case",
      "https://h/org/a",
    ]) {
      const label = deriveMountLabel({ remote, store_uuid: UUID });
      expect(STORE_MOUNT_NAME_PATTERN.test(label)).toBe(true);
    }
  });
});

describe("initStore D4b — pre-creates all 5 category dirs with .gitkeep", () => {
  it("scaffolds every knowledge type dir with a committed .gitkeep", async () => {
    const { storesRoot } = createIsolatedHome();
    const storeDir = join(storesRoot, "team", "fresh-kb");
    await initStore(
      storeDir,
      { store_uuid: UUID, created_at: "2026-06-10T00:00:00.000Z", canonical_alias: "fresh" },
      { git: false },
    );
    for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
      const gitkeep = join(storeDir, STORE_LAYOUT.knowledgeDir, type, ".gitkeep");
      expect(existsSync(gitkeep)).toBe(true);
      expect(readFileSync(gitkeep, "utf8")).toBe("");
    }
  });
});
