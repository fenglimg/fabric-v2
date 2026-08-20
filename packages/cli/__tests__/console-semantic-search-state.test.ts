/**
 * 「已启用 · 未生效」 — the settings page reporting a switch's INTENT and its
 * EFFECT as two separate facts.
 *
 * `embed_enabled` is the only field on the page whose value the machine can
 * refuse. Turning it on does not install `fastembed` and does not download a
 * model, so a page that echoes the switch back is telling a user their search
 * is semantic when it is keyword-only. What these pin is that the page reports
 * the difference, and that it distinguishes the failure that fixes itself (the
 * model downloads on the next search) from the one that does not.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PANEL_ENV_OVERRIDES } from "@fenglimg/fabric-shared";

const gatherRecallStatusMock = vi.fn();

// Only the probe is mocked. Everything the page decides — which layer wins for
// `embed_enabled`, whether the remote transport counts — stays real, because
// that is what these tests are about.
vi.mock("../src/commands/info.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/commands/info.ts")>();
  return { ...actual, gatherRecallStatus: () => gatherRecallStatusMock() };
});

const { collectGlobalConfigView } = await import("../src/console/global-config-view.ts");

const dirs: string[] = [];
let savedHome: string | undefined;
const savedEnv = new Map<string, string | undefined>();
const EMBED_ENV = [
  "FABRIC_EMBED_ENDPOINT",
  "FABRIC_EMBED_API_KEY",
  "FABRIC_EMBED_MODEL",
] as const;

/** A machine with the local embedder fully installed and the model on disk. */
function probe(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fusion_configured: "auto",
    fusion_effective: "additive",
    fusion_reason: "test",
    // Deliberately the OPPOSITE of what the fixtures configure: the page must
    // take the intent from its own layer walk, never from the probe's read of
    // the launch directory. A test whose probe agreed could not tell them apart.
    embed_enabled: false,
    embed_model: "bge-small-en-v1.5",
    fastembed_resolvable: true,
    model_cache_dir: "/tmp/fab-model-cache",
    model_cached: true,
    vector_ready: false,
    ...over,
  };
}

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-sem-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
  for (const name of [...Object.values(PANEL_ENV_OVERRIDES), ...EMBED_ENV]) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
  gatherRecallStatusMock.mockReset();
  gatherRecallStatusMock.mockReturnValue(probe());
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

function writeGlobal(config: Record<string, unknown>): void {
  mkdirSync(join(process.env.FABRIC_HOME as string, ".fabric"), { recursive: true });
  writeFileSync(
    join(process.env.FABRIC_HOME as string, ".fabric", "fabric-global.json"),
    JSON.stringify({ uid: "u-test", stores: [], ...config }, null, 2),
    "utf8",
  );
}

function bareDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-sem-bare-"));
  dirs.push(dir);
  return dir;
}

async function state(config: Record<string, unknown>) {
  writeGlobal(config);
  return (await collectGlobalConfigView(bareDir())).semanticSearch;
}

describe("semantic search — intent and effect are separate facts", () => {
  it("takes the switch from the page's own layer walk, not from the probe", async () => {
    // The probe reports `embed_enabled: false` in every fixture here (see probe()).
    // Reading the switch from there would make this row report the launch
    // directory's resolution on a page that describes the machine.
    const on = await state({ defaults: { embed_enabled: true } });
    expect(on.enabled).toBe(true);
    expect(on.ready).toBe(true);
  });

  it("says nothing is wrong when the switch is simply off", async () => {
    gatherRecallStatusMock.mockReturnValue(probe({ fastembed_resolvable: false }));
    const off = await state({ defaults: { embed_enabled: false } });
    expect(off.enabled).toBe(false);
    expect(off.ready).toBe(false);
    // No blocker: a missing package is not a problem for a feature nobody asked
    // for. Reporting one here would put a permanent warning on every machine
    // that never turned semantic search on.
    expect(off.blocker).toBeNull();
  });

  it("reports the package as the blocker when the server cannot load fastembed", async () => {
    gatherRecallStatusMock.mockReturnValue(
      probe({ fastembed_resolvable: false, model_cached: false }),
    );
    const s = await state({ defaults: { embed_enabled: true } });
    expect(s.ready).toBe(false);
    // Both probes are false; the package is named because it is the one that
    // has to be fixed FIRST — telling this user to wait for a download would
    // have them wait forever.
    expect(s.blocker).toBe("package-missing");
  });

  it("distinguishes a not-yet-downloaded model from a broken install", async () => {
    // The discriminator for the whole feature. Both states are "on but not
    // scoring"; only one of them is the user's problem. Collapsing them is the
    // obvious implementation and the wrong one.
    gatherRecallStatusMock.mockReturnValue(probe({ model_cached: false }));
    const s = await state({ defaults: { embed_enabled: true } });
    expect(s.ready).toBe(false);
    expect(s.blocker).toBe("model-missing");
    // The page needs both to write the "it downloads to X on the next search"
    // line — a next step with no destination is not a next step.
    expect(s.model).toBe("bge-small-en-v1.5");
    expect(s.modelCacheDir).toBe("/tmp/fab-model-cache");
  });

  it("is in force through a remote embedder with no local package or model", async () => {
    gatherRecallStatusMock.mockReturnValue(
      probe({ fastembed_resolvable: false, model_cached: false }),
    );
    const s = await state({
      defaults: { embed_enabled: true },
      embed_endpoint: "https://embed.example/v1",
      embed_api_key: "sk-test",
    });
    expect(s.remote).toBe(true);
    expect(s.ready).toBe(true);
    expect(s.blocker).toBeNull();
  });

  it("does not call an endpoint with no key ready", async () => {
    // An endpoint without a key is a 401 on every request, which reaches the
    // user as silence. Counting the endpoint alone as "configured" would put
    // the reassuring line on exactly the machine that is broken.
    gatherRecallStatusMock.mockReturnValue(
      probe({ fastembed_resolvable: false, model_cached: false }),
    );
    const s = await state({
      defaults: { embed_enabled: true },
      embed_endpoint: "https://embed.example/v1",
    });
    expect(s.remote).toBe(false);
    expect(s.ready).toBe(false);
    expect(s.blocker).toBe("package-missing");
  });

  it("ships a string for every state it can be in", async () => {
    writeGlobal({ defaults: { embed_enabled: true } });
    const view = await collectGlobalConfigView(bareDir());
    for (const key of [
      "semantic.ready",
      "semantic.off",
      "semantic.remote",
      "semantic.model-missing",
      "semantic.package-missing",
    ]) {
      // A state with no string renders as blank on the page — the failure mode
      // is invisible rather than loud, so it gets asserted rather than noticed.
      expect(view.strings[key], key).toBeTruthy();
    }
  });
});
