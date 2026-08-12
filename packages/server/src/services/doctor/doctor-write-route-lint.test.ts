import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWriteRouteUnboundCheck,
  detectWriteRouteUnbound,
} from "./doctor-write-route-lint.js";

// write_route_target_unbound: catches werewolf-style "route survived migration
// to single team slot" — write_routes[i].store not in required_stores[*].id.

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function projectWithConfig(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "fab-wroute-"));
  dirs.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(join(root, ".fabric", "fabric-config.json"), JSON.stringify(config), "utf8");
  return root;
}

const t = ((key: string) => key) as never;

describe("detectWriteRouteUnbound", () => {
  it("returns [] when a write_route target is in required_stores", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      write_routes: [{ scope: "team", store: "team" }],
    });
    expect(detectWriteRouteUnbound(root)).toEqual([]);
  });

  it("flags the werewolf case: route.store not in required_stores", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      write_routes: [{ scope: "team", store: "wespy-team-cocos-knowledge-base" }],
    });
    const violations = detectWriteRouteUnbound(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      scope: "team",
      store: "wespy-team-cocos-knowledge-base",
    });
  });

  it("returns [] when write_routes is absent (no ambient routing)", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
    });
    expect(detectWriteRouteUnbound(root)).toEqual([]);
  });

  it("collects multiple violations independently", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      write_routes: [
        { scope: "team", store: "team" }, // ok
        { scope: "project:x", store: "cocos" }, // bad
        { scope: "project:y", store: "another-store" }, // bad
      ],
    });
    const violations = detectWriteRouteUnbound(root);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.scope)).toEqual(["project:x", "project:y"]);
  });

  it("returns [] (never throws) when project config is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "fab-wroute-empty-"));
    dirs.push(root);
    expect(detectWriteRouteUnbound(root)).toEqual([]);
  });
});

describe("createWriteRouteUnboundCheck", () => {
  it("renders ok status when there are no violations", () => {
    const check = createWriteRouteUnboundCheck(t, []);
    expect(check.status).toBe("ok");
    expect(check.code).toBeUndefined();
  });

  it("renders an advisory warning with the write_route_target_unbound code", () => {
    const check = createWriteRouteUnboundCheck(t, [
      { scope: "team", store: "wespy-team-cocos-knowledge-base" },
    ]);
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("write_route_target_unbound");
    expect(check.fixable).toBe(false);
  });
});
