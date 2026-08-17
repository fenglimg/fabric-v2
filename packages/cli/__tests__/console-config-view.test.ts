/**
 * `GET /api/config` — the console's configuration view.
 *
 * Two properties matter here and neither is about layout:
 *
 *  1. The field list is DERIVED from `getPanelFields()`. A hand-written list
 *     drifts the moment someone adds a knob, and the drift is invisible: the
 *     page still renders, just without the new field.
 *  2. No secret reaches the wire. The panel field set contains no credential, so
 *     a per-field masking assertion would be checking an empty set — green
 *     forever, proving nothing (the shape KT-PIT-0062 describes). The canary
 *     below asserts the response as a WHOLE, which also catches the likeliest
 *     real leak: someone spreading the global config object into the payload.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPanelFields, PANEL_ENV_OVERRIDES } from "@fenglimg/fabric-shared";

import { collectConfigView } from "../src/console/config-view.ts";

const CANARY = "sk-CANARY-DO-NOT-LEAK-0001";
const dirs: string[] = [];
let savedHome: string | undefined;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-cfgview-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
  for (const name of Object.values(PANEL_ENV_OVERRIDES)) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(identity: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-cfgview-repo-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".fabric"), { recursive: true });
  writeFileSync(
    join(dir, ".fabric", "fabric-config.json"),
    JSON.stringify(identity, null, 2),
    "utf8",
  );
  return dir;
}

function writeGlobal(config: Record<string, unknown>): void {
  const home = process.env.FABRIC_HOME as string;
  mkdirSync(join(home, ".fabric"), { recursive: true });
  writeFileSync(
    join(home, ".fabric", "fabric-global.json"),
    JSON.stringify({ uid: "u-test", stores: [], ...config }, null, 2),
    "utf8",
  );
}

describe("collectConfigView", () => {
  it("field list tracks getPanelFields exactly, in order", () => {
    writeGlobal({});
    const view = collectConfigView(makeRepo({ project_id: "p1" }));
    expect(view.fields.map((f) => f.key)).toEqual(getPanelFields().map((f) => String(f.key)));
  });

  it("the view module names no panel key of its own", () => {
    // The assertion above compares the view against getPanelFields(), which is
    // ALSO where a hardcoded copy would have been transcribed from — a list
    // frozen by hand today would still match today. This one reads the module's
    // source instead: if it mentions no key, it cannot be maintaining a list,
    // so a key added to the schema tomorrow appears with no edit here.
    const source = readFileSync(
      fileURLToPath(new URL("../src/console/config-view.ts", import.meta.url)),
      "utf8",
    );
    const mentioned = getPanelFields()
      .map((f) => String(f.key))
      .filter((key) => source.includes(key));
    expect(mentioned).toEqual([]);
  });

  it("every field carries a rendered label and description, not an i18n key", () => {
    // A missing string would surface as the raw key; that is the failure mode a
    // count-only assertion misses.
    writeGlobal({});
    for (const field of collectConfigView(makeRepo({ project_id: "p1" })).fields) {
      expect(field.label).not.toMatch(/^cli\./);
      expect(field.description).not.toMatch(/^cli\./);
      expect(field.sourceLabel.length).toBeGreaterThan(0);
    }
  });

  it("reports the layer that supplied each value", () => {
    writeGlobal({
      language: "en",
      defaults: { archive_hint_hours: 48 },
      projects: { p1: { nudge_mode: "silent" } },
    });
    const view = collectConfigView(makeRepo({ project_id: "p1" }));
    const by = (key: string) => view.fields.find((f) => f.key === key);

    expect(by("nudge_mode")?.source).toBe("project");
    expect(by("nudge_mode")?.effective).toBe("silent");
    expect(by("archive_hint_hours")?.source).toBe("defaults");
    expect(by("archive_hint_hours")?.effective).toBe("48");
    expect(by("fabric_language")?.source).toBe("global");
    // Nothing set it anywhere → built-in.
    expect(by("review_stale_pending_days")?.source).toBe("default");
  });

  it("marks env-decided fields as not editable and names the variable", () => {
    writeGlobal({ defaults: { fusion: "additive" } });
    process.env.FABRIC_FUSION = "rrf";
    const view = collectConfigView(makeRepo({ project_id: "p1" }));
    const fusion = view.fields.find((f) => f.key === "fusion");

    expect(fusion?.source).toBe("env");
    expect(fusion?.effective).toBe("rrf");
    expect(fusion?.editable).toBe(false);
    expect(fusion?.envVar).toBe("FABRIC_FUSION");
  });

  it("names an available env override even when it is not currently set", () => {
    writeGlobal({ defaults: { fusion: "additive" } });
    const fusion = collectConfigView(makeRepo({ project_id: "p1" })).fields.find(
      (f) => f.key === "fusion",
    );
    expect(fusion?.envVar).toBe("FABRIC_FUSION");
    expect(fusion?.editable).toBe(true);
  });

  it("keys with no env reader report envVar null", () => {
    writeGlobal({});
    const auditMode = collectConfigView(makeRepo({ project_id: "p1" })).fields.find(
      (f) => f.key === "audit_mode",
    );
    expect(auditMode?.envVar).toBeNull();
  });

  describe("remote embedding is reported as shape, not content", () => {
    it("off when nothing is configured", () => {
      writeGlobal({});
      expect(collectConfigView(makeRepo({ project_id: "p1" })).remoteEmbedding).toEqual({
        configured: false,
        endpointHost: null,
        hasApiKey: false,
        model: null,
      });
    });

    it("reports host / key-presence / model but never the key", () => {
      writeGlobal({
        embed_remote: {
          endpoint: "https://api.example.com/v1/embeddings?token=leak-me",
          api_key: CANARY,
          model: "BAAI/bge-m3",
        },
      });
      const view = collectConfigView(makeRepo({ project_id: "p1" }));

      expect(view.remoteEmbedding.configured).toBe(true);
      expect(view.remoteEmbedding.hasApiKey).toBe(true);
      expect(view.remoteEmbedding.model).toBe("BAAI/bge-m3");
      // Host only — the query string of a real endpoint is a plausible place for
      // a credential, so the full URL never comes back.
      expect(view.remoteEmbedding.endpointHost).toBe("api.example.com");
      expect(JSON.stringify(view)).not.toContain("leak-me");
    });

    it("detects the pre-W2 FLAT keys, not just the nested object", () => {
      // The real dogfood machine carries exactly this shape. Reading only
      // `embed_remote` reported "off" while recall was going over the network —
      // a display that lies, on the one page whose job is to not do that.
      writeGlobal({
        embed_endpoint: "https://flat.example.com/v1",
        embed_api_key: CANARY,
        embed_model: "BAAI/bge-m3",
      });
      const remote = collectConfigView(makeRepo({ project_id: "p1" })).remoteEmbedding;

      expect(remote.configured).toBe(true);
      expect(remote.endpointHost).toBe("flat.example.com");
      expect(remote.hasApiKey).toBe(true);
      expect(remote.model).toBe("BAAI/bge-m3");
    });

    it("the nested object wins over the flat keys, as the loader does", () => {
      writeGlobal({
        embed_endpoint: "https://flat.example.com/v1",
        embed_remote: { endpoint: "https://nested.example.com/v1" },
      });
      expect(
        collectConfigView(makeRepo({ project_id: "p1" })).remoteEmbedding.endpointHost,
      ).toBe("nested.example.com");
    });

    it("CANARY: no secret from the global config appears anywhere in the payload", () => {
      writeGlobal({
        embed_remote: { endpoint: "https://api.example.com/v1", api_key: CANARY },
        // A stray top-level secret too — the flat form the config loader also reads.
        embed_api_key: CANARY,
        defaults: { nudge_mode: "silent" },
      });
      const serialized = JSON.stringify(collectConfigView(makeRepo({ project_id: "p1" })));

      expect(serialized).not.toContain(CANARY);
      // Control: the view is not empty for some unrelated reason, so the
      // assertion above is actually examining a populated payload.
      expect(serialized).toContain("nudge_mode");
      expect(serialized.length).toBeGreaterThan(500);
    });
  });
});
