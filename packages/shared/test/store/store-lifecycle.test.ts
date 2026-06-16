import { describe, expect, it } from "vitest";

import { globalConfigSchema, type GlobalConfig } from "../../src/schemas/store.js";
import {
  addMountedStore,
  bindRequiredStore,
  detachMountedStore,
  disambiguateAlias,
  explainStore,
  findMountedStore,
} from "../../src/store/store-lifecycle.js";
import { scrubRemoteUrl } from "../../src/store/secret-scan.js";

// v2.1.0-rc.1 P3 — store lifecycle config-core unit tests (S57/E4/S7).

const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATFORM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function baseConfig(): GlobalConfig {
  return globalConfigSchema.parse({
    uid: "u-abc",
    stores: [{ store_uuid: TEAM, alias: "team", remote: "git@h:team.git" }],
  });
}

describe("P3 store lifecycle — add", () => {
  it("adds a new mounted store", () => {
    const next = addMountedStore(baseConfig(), { store_uuid: PLATFORM, alias: "platform" });
    expect(next.stores).toHaveLength(2);
    expect(findMountedStore(next, "platform")?.store_uuid).toBe(PLATFORM);
  });

  it("idempotently updates the same store_uuid in place", () => {
    const next = addMountedStore(baseConfig(), {
      store_uuid: TEAM,
      alias: "team",
      remote: "git@h:team-new.git",
    });
    expect(next.stores).toHaveLength(1);
    expect(findMountedStore(next, "team")?.remote).toBe("git@h:team-new.git");
  });

  it("rejects an alias collision against a different store", () => {
    expect(() =>
      addMountedStore(baseConfig(), { store_uuid: PLATFORM, alias: "team" }),
    ).toThrow(/alias 'team' already mounts/);
  });
});

describe("P3 store lifecycle — detach ≠ delete (E4)", () => {
  it("removes from the registry and returns the detached entry", () => {
    const { config, detached } = detachMountedStore(baseConfig(), "team");
    expect(detached?.store_uuid).toBe(TEAM);
    expect(config.stores).toHaveLength(0);
  });

  it("is a no-op for an unknown alias", () => {
    const { config, detached } = detachMountedStore(baseConfig(), "nope");
    expect(detached).toBeNull();
    expect(config.stores).toHaveLength(1);
  });
});

describe("P3 store lifecycle — bind + explain", () => {
  it("binds a required store and dedupes by id", () => {
    const r1 = bindRequiredStore([], { id: "team", suggested_remote: "git@h:team.git" });
    const r2 = bindRequiredStore(r1, { id: "team", suggested_remote: "git@h:team-2.git" });
    expect(r2).toHaveLength(1);
    expect(r2[0].suggested_remote).toBe("git@h:team-2.git");
  });

  it("explains a mounted store and flags local-only", () => {
    const cfg = addMountedStore(baseConfig(), { store_uuid: PLATFORM, alias: "platform" });
    expect(explainStore(cfg, "team")?.local_only).toBe(false);
    expect(explainStore(cfg, "platform")?.local_only).toBe(true);
    expect(explainStore(cfg, "ghost")).toBeNull();
  });

  // W4-09 (ISS-044): credential userinfo must never be persisted into the
  // registry — auth lives in .git/config, not a shared/tracked store entry.
  it("scrubs credential userinfo from a mounted store's remote", () => {
    const cfg = addMountedStore(baseConfig(), {
      store_uuid: PLATFORM,
      alias: "platform",
      remote: "https://user:ghp_secrettoken@github.com/org/repo.git",
    });
    const stored = findMountedStore(cfg, "platform")?.remote;
    expect(stored).toBe("https://github.com/org/repo.git");
    expect(stored).not.toContain("ghp_secrettoken");
  });

  it("scrubs credential userinfo from a bound suggested_remote", () => {
    const r = bindRequiredStore([], {
      id: "team",
      suggested_remote: "https://x-access-token:abc123@gitlab.com/g/r.git",
    });
    expect(r[0].suggested_remote).toBe("https://gitlab.com/g/r.git");
    expect(r[0].suggested_remote).not.toContain("abc123");
  });

  it("leaves credential-free remotes untouched (scp-like)", () => {
    const cfg = addMountedStore(baseConfig(), {
      store_uuid: PLATFORM,
      alias: "platform",
      remote: "git@github.com:org/repo.git",
    });
    expect(findMountedStore(cfg, "platform")?.remote).toBe("git@github.com:org/repo.git");
  });
});

describe("disambiguateAlias (store-onboarding grill Q6)", () => {
  it("returns the desired alias unchanged when it is free", () => {
    expect(disambiguateAlias(["personal", "team"], "platform")).toBe("platform");
    expect(disambiguateAlias([], "team")).toBe("team");
  });

  it("appends a numeric suffix on collision", () => {
    expect(disambiguateAlias(["team"], "team")).toBe("team-2");
  });

  it("skips already-taken suffixes until it finds a free one", () => {
    expect(disambiguateAlias(["team", "team-2", "team-3"], "team")).toBe("team-4");
  });
});

describe("scrubRemoteUrl (ISS-044)", () => {
  it("strips user:token userinfo from a scheme URL", () => {
    expect(scrubRemoteUrl("https://u:tok@h/r.git")).toBe("https://h/r.git");
    expect(scrubRemoteUrl("ssh://user:pass@host:22/r")).toBe("ssh://host:22/r");
  });
  it("leaves credential-free forms unchanged", () => {
    expect(scrubRemoteUrl("git@github.com:org/repo.git")).toBe("git@github.com:org/repo.git");
    expect(scrubRemoteUrl("ssh://git@host/r")).toBe("ssh://git@host/r");
    expect(scrubRemoteUrl("https://github.com/org/repo.git")).toBe("https://github.com/org/repo.git");
  });
  // F62 (ISS-20260531-103): a PAT passed as bare http(s) userinfo (no ':'
  // password separator) must be stripped — the original ':'-requiring regex
  // leaked it verbatim into the persisted registry.
  it("strips bare http(s) userinfo tokens with no ':' separator", () => {
    expect(scrubRemoteUrl("https://ghp_TokenSecret@github.com/org/repo.git")).toBe(
      "https://github.com/org/repo.git",
    );
    expect(scrubRemoteUrl("http://x-access-token@gitlab.com/g/r.git")).toBe(
      "http://gitlab.com/g/r.git",
    );
    // bare userinfo + explicit port stays intact except the credential
    expect(scrubRemoteUrl("https://ghp_tok@host:8443/r.git")).toBe("https://host:8443/r.git");
  });
});
