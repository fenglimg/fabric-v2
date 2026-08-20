/**
 * `GET /api/integrations` — the listing whose only source is the filesystem.
 *
 * Two things are pinned here and they are different in kind:
 *
 *   1. THE ORACLE. Every artifact row must come from comparing bytes on disk to
 *      bytes in the template tree. The tests that matter delete, edit, and add
 *      files in a fixture project and assert the payload follows — because the
 *      failure mode this endpoint exists to avoid (KT-PIT-0067) is a listing
 *      that reads a hand-maintained boolean and therefore stays green while the
 *      tree says otherwise. A test that only asserted shape would pass against
 *      exactly that defect.
 *
 *   2. THE FENCES. The behaviour registry is the one hand-written table on this
 *      page, so it is checked against the live registries: no invented hook, no
 *      invented key, no hook that quietly has no row, and — the load-bearing one
 *      — a TOTAL partition of the panel keys, so a key added to the schema
 *      cannot land in neither bucket.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isRepairAction, runRepair } from "../src/console/integrations-repair.js";

import {
  HOOK_REGISTRATIONS,
  PANEL_ENV_OVERRIDES,
  fabricHookConfigFor,
  getPanelFields,
} from "@fenglimg/fabric-shared";
import { resolveBootstrapCanonical } from "@fenglimg/fabric-shared/templates/bootstrap-canonical";

import { collectIntegrations } from "../src/console/integrations-view.ts";
import {
  BEHAVIORS,
  NON_HOOK_KEYS,
  UNWIRED_BEHAVIOR_KEYS,
} from "../src/console/integrations-registry.ts";
import {
  FABRIC_SKILL_INSTALL_SPECS,
  HOOK_LIB_DESTINATIONS,
  HOOK_SCRIPT_DESTINATIONS,
  SKILL_DESTINATIONS,
  SKILL_LIB_DESTINATIONS,
} from "../src/install/distribution-targets.ts";
import { findTemplatePath } from "../src/install/template-io.ts";

const dirs: string[] = [];
let savedHome: string | undefined;
const savedEnv = new Map<string, string | undefined>();
// `FABRIC_HOME` is not the only home this view reads. The MCP probe looks for
// the user-level registration at `$HOME/.claude.json` and `$HOME/.codex/config.toml`
// — real files on a developer machine, where Fabric is registered — so pointing
// only `FABRIC_HOME` at a temp dir left "an empty directory has nothing
// installed" reading the machine running the test. It failed for anyone who had
// actually installed Fabric and passed in CI, which is the worst orientation for
// that pair.
const HOME_VARS = ["HOME", "USERPROFILE"] as const;
const savedHomeVars = new Map<string, string | undefined>();

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-int-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
  for (const name of HOME_VARS) {
    savedHomeVars.set(name, process.env[name]);
    process.env[name] = home;
  }
  mkdirSync(join(home, ".fabric"), { recursive: true });
  writeFileSync(
    join(home, ".fabric", "fabric-global.json"),
    JSON.stringify({ uid: "u-test", stores: [] }),
    "utf8",
  );
  for (const name of Object.values(PANEL_ENV_OVERRIDES)) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  for (const [name, value] of savedHomeVars) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedHomeVars.clear();
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Write `content` at a project-relative POSIX path, creating parents. */
function put(root: string, rel: string, content: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function templateText(rel: string): string {
  return readFileSync(findTemplatePath(rel), "utf8");
}

/**
 * A project installed exactly as `fabric install` would leave it: every hook
 * script, every skill (with its `ref/` companions), every shared lib, both hook
 * configs, both bootstrap surfaces, and the MCP entry.
 *
 * Built by COPYING the template tree rather than by writing placeholder bytes.
 * Placeholders would make every row `modified` and the interesting assertions
 * ("a healthy install reports ok") vacuous.
 */
function installedProject(): string {
  const root = mkdtempSync(join(tmpdir(), "fab-int-proj-"));
  dirs.push(root);

  for (const destinations of Object.values(HOOK_SCRIPT_DESTINATIONS)) {
    for (const rel of destinations) {
      const basename = rel.slice(rel.lastIndexOf("/") + 1);
      put(root, rel, templateText(`hooks/${basename}`));
    }
  }
  for (const spec of Object.values(FABRIC_SKILL_INSTALL_SPECS)) {
    for (const rel of spec.destinations) {
      put(root, rel, templateText(spec.templateRel));
      const refTemplateDir = `${dirname(spec.templateRel)}/ref`;
      let refDir: string;
      try {
        refDir = findTemplatePath(refTemplateDir);
      } catch {
        continue;
      }
      cpSync(refDir, join(root, ...`${dirname(rel)}/ref`.split("/")), { recursive: true });
    }
  }
  for (const rel of HOOK_LIB_DESTINATIONS) {
    cpSync(findTemplatePath("hooks/lib"), join(root, ...rel.split("/")), { recursive: true });
  }
  for (const rel of SKILL_LIB_DESTINATIONS) {
    cpSync(findTemplatePath("skills/lib"), join(root, ...rel.split("/")), { recursive: true });
  }

  const canonical = resolveBootstrapCanonical();
  put(root, ".fabric/AGENTS.md", canonical);
  put(root, "CLAUDE.md", `# Project Knowledge\n\n@.fabric/AGENTS.md\n`);
  put(
    root,
    "AGENTS.md",
    `<!-- fabric:bootstrap:begin -->\n${canonical}\n<!-- fabric:bootstrap:end -->\n`,
  );
  put(root, ".mcp.json", JSON.stringify({ mcpServers: { fabric: { command: "node" } } }));
  for (const client of ["claudeCode", "codex"] as const) {
    put(
      root,
      HOOK_REGISTRATIONS[client].configFile,
      JSON.stringify(fabricHookConfigFor(client), null, 2),
    );
  }
  return root;
}

function scopeOf(root: string) {
  return { kind: "project" as const, projectId: "p-test", projectRoot: root };
}

function groupsOf(view: Awaited<ReturnType<typeof collectIntegrations>>, client: "claudeCode" | "codex") {
  const entry = view.clients.find((c) => c.id === client);
  if (entry === undefined) throw new Error(`no client ${client}`);
  return [...entry.hooks, ...entry.skills, ...entry.libs];
}

describe("the listing is computed from the tree, not from a list of booleans", () => {
  it("reports a fully installed project as matching, with no problems anywhere", async () => {
    const view = await collectIntegrations(scopeOf(installedProject()));

    expect(view.clients.map((c) => c.id)).toEqual(["claudeCode", "codex"]);
    for (const client of view.clients) {
      // The roll-up AND the per-file detail, because a `problems: 0` computed
      // from an empty file list would also pass the first assertion.
      expect({ id: client.id, problems: client.problems }).toEqual({ id: client.id, problems: 0 });
      expect(client.hooks.length).toBe(Object.keys(HOOK_SCRIPT_DESTINATIONS).length);
      expect(client.skills.length).toBe(Object.keys(SKILL_DESTINATIONS).length);
      for (const group of [...client.hooks, ...client.skills, ...client.libs]) {
        expect({ id: group.id, state: group.state, problems: group.problems }).toEqual({
          id: group.id,
          state: "ok",
          problems: [],
        });
        expect(group.fileCount).toBeGreaterThan(0);
      }
    }
  });

  it("shows a deleted skill as missing — the case a boolean manifest cannot see", async () => {
    const root = installedProject();
    const rel = SKILL_DESTINATIONS.fabricArchive[0];
    rmSync(join(root, ...rel.split("/")));

    const view = await collectIntegrations(scopeOf(root));
    const group = groupsOf(view, "claudeCode").find((g) => g.id === "fabric-archive");

    expect(group?.state).toBe("missing");
    expect(group?.problems).toContainEqual({ path: rel, state: "missing" });
    // The sibling client still has its copy: the two trees are read separately.
    expect(groupsOf(view, "codex").find((g) => g.id === "fabric-archive")?.state).toBe("ok");
  });

  it("shows a hand-edited hook as differing from the template", async () => {
    const root = installedProject();
    const rel = HOOK_SCRIPT_DESTINATIONS.fabricHint[0];
    writeFileSync(join(root, ...rel.split("/")), "// tampered\n", "utf8");

    const group = groupsOf(await collectIntegrations(scopeOf(root)), "claudeCode").find(
      (g) => g.id === "fabric-hint.cjs",
    );
    expect(group?.state).toBe("modified");
    expect(group?.problems).toEqual([{ path: rel, state: "modified" }]);
  });

  it("shows a companion file no template ships as left over", async () => {
    const root = installedProject();
    const rel = `${dirname(SKILL_DESTINATIONS.fabricReview[0])}/ref/from-an-older-release.md`;
    put(root, rel, "stale guidance\n");

    const group = groupsOf(await collectIntegrations(scopeOf(root)), "claudeCode").find(
      (g) => g.id === "fabric-review",
    );
    // `orphan`, not `modified`: install never prunes, so this file is still
    // being read by the client even though nothing ships it any more.
    expect(group?.problems).toEqual([{ path: rel, state: "orphan" }]);
    expect(group?.state).toBe("orphan");
  });

  it("reports nothing installed for an empty directory rather than throwing", async () => {
    const root = mkdtempSync(join(tmpdir(), "fab-int-empty-"));
    dirs.push(root);

    const view = await collectIntegrations(scopeOf(root));
    for (const client of view.clients) {
      expect(client.problems).toBe(client.hooks.length + client.skills.length + client.libs.length);
      expect(client.hooks.every((g) => g.state === "missing")).toBe(true);
      expect(client.mcp.connected).toBe(false);
      expect(client.bootstrap.state).toBe("missing");
    }
    expect(view.manifest.status).toBe("no-manifest");
  });
});

describe("MCP connection", () => {
  it("reads the entry out of the client's own config file", async () => {
    const root = installedProject();
    const view = await collectIntegrations(scopeOf(root));

    const claude = view.clients.find((c) => c.id === "claudeCode");
    expect(claude?.mcp).toEqual({ connected: true, path: ".mcp.json", location: "project" });
  });

  it("treats a config holding OTHER servers as not connected", async () => {
    const root = installedProject();
    // The realistic false positive: a user with three MCP servers configured
    // and Fabric not among them. Keying off "the file exists" would call this
    // connected, which is precisely the class of answer this page must not give.
    put(root, ".mcp.json", JSON.stringify({ mcpServers: { other: { command: "node" } } }));

    const view = await collectIntegrations(scopeOf(root));
    expect(view.clients.find((c) => c.id === "claudeCode")?.mcp.connected).toBe(false);
  });
});

describe("bootstrap — the rules the agent actually reads", () => {
  it("calls a stale snapshot modified even though the import line is present", async () => {
    const root = installedProject();
    put(root, ".fabric/AGENTS.md", "# Project Knowledge\n\nrules from three releases ago\n");

    const view = await collectIntegrations(scopeOf(root));
    // Claude Code resolves `@.fabric/AGENTS.md` at runtime, so the import line
    // being present says nothing about what it resolves TO. Reporting `ok` here
    // would tell a user their agent has current rules while it reads old ones.
    expect(view.clients.find((c) => c.id === "claudeCode")?.bootstrap.state).toBe("modified");
  });

  it("calls a Codex managed block whose body drifted from the snapshot modified", async () => {
    const root = installedProject();
    put(root, "AGENTS.md", `<!-- fabric:bootstrap:begin -->\nold body\n<!-- fabric:bootstrap:end -->\n`);

    const view = await collectIntegrations(scopeOf(root));
    expect(view.clients.find((c) => c.id === "codex")?.bootstrap.state).toBe("modified");
  });
});

describe("behaviours — a hook runs only when the file is there AND registered", () => {
  it("reports an installed, registered hook as active", async () => {
    const view = await collectIntegrations(scopeOf(installedProject()));
    const behavior = view.behaviors.find((b) => b.id === "fabric-hint");

    expect(behavior?.active).toBe(true);
    expect(behavior?.presence).toEqual([
      { client: "claudeCode", file: "ok", registered: true },
      { client: "codex", file: "ok", registered: true },
    ]);
    expect(behavior?.events).toContain("Stop");
  });

  it("reports an installed but UNREGISTERED hook as not active", async () => {
    const root = installedProject();
    // The file is untouched — only the client's config loses the entry. This is
    // the state a per-file drift list reports as perfectly healthy, and it is
    // the state in which the hook never fires.
    for (const client of ["claudeCode", "codex"] as const) {
      put(root, HOOK_REGISTRATIONS[client].configFile, JSON.stringify({}));
    }

    const view = await collectIntegrations(scopeOf(root));
    const behavior = view.behaviors.find((b) => b.id === "fabric-hint");
    expect(behavior?.active).toBe(false);
    expect(behavior?.presence.every((p) => p.file === "ok" && !p.registered)).toBe(true);
  });

  it("carries each behaviour's knobs resolved the same way the settings page resolves them", async () => {
    const root = installedProject();
    // Deliberately NOT the schema default (`normal`): an assertion that happened
    // to match the default would pass against a collector that ignored the
    // config entirely (KT-PIT-0062).
    writeFileSync(
      join(process.env.FABRIC_HOME as string, ".fabric", "fabric-global.json"),
      JSON.stringify({ uid: "u-test", stores: [], defaults: { nudge_mode: "silent" } }),
      "utf8",
    );

    const view = await collectIntegrations(scopeOf(root));
    const nudge = view.behaviors
      .find((b) => b.id === "fabric-hint")
      ?.keys.find((k) => k.key === "nudge_mode");
    expect(nudge?.effective).toBe("silent");
    expect(nudge?.source).toBe("defaults");
    // INHERITED, not set here. This page resolves against `p-test`, so the
    // machine-wide value is one layer up — and the row's marker says "set here,
    // no longer follows the layer below" while its reset button removes the
    // project's own entry. Both are wrong about a value the project never wrote:
    // the sentence is false and the button has nothing to remove.
    expect(nudge?.modified).toBe(false);
    expect(nudge?.inherited).toBe(true);
    expect(nudge?.sourceLabel.length).toBeGreaterThan(0);
  });

  it("marks a knob the PROJECT itself set as set here, not as inherited", async () => {
    // The other half of the discriminator. Same key, same page, same fixture —
    // only the layer holding the value moves. Without this pair, an implementation
    // that answered a constant would pass one of the two (KT-PIT-0097).
    const root = installedProject();
    writeFileSync(
      join(process.env.FABRIC_HOME as string, ".fabric", "fabric-global.json"),
      JSON.stringify({
        uid: "u-test",
        stores: [],
        // Both layers hold a value, and DIFFERENT ones: if the resolver were
        // reading the wrong layer, `effective` would say so out loud.
        defaults: { nudge_mode: "normal" },
        projects: { "p-test": { nudge_mode: "silent" } },
      }),
      "utf8",
    );

    const nudge = (await collectIntegrations(scopeOf(root))).behaviors
      .find((b) => b.id === "fabric-hint")
      ?.keys.find((k) => k.key === "nudge_mode");
    expect(nudge?.effective).toBe("silent");
    expect(nudge?.source).toBe("project");
    expect(nudge?.modified).toBe(true);
    expect(nudge?.inherited).toBe(false);
  });

  it("marks a knob no layer ever set as neither", async () => {
    // The third state. `modified` and `inherited` are not complements — a page
    // that rendered `!modified` as "inherited from …" would name a layer that
    // holds nothing.
    const root = installedProject();
    writeFileSync(
      join(process.env.FABRIC_HOME as string, ".fabric", "fabric-global.json"),
      JSON.stringify({ uid: "u-test", stores: [] }),
      "utf8",
    );

    const nudge = (await collectIntegrations(scopeOf(root))).behaviors
      .find((b) => b.id === "fabric-hint")
      ?.keys.find((k) => k.key === "nudge_mode");
    expect(nudge?.source).toBe("default");
    expect(nudge?.modified).toBe(false);
    expect(nudge?.inherited).toBe(false);
  });

  it("renders one control per key, and cross-references the other readers", async () => {
    const view = await collectIntegrations(scopeOf(installedProject()));
    const controls = view.behaviors.flatMap((b) => b.keys.map((k) => k.key));
    expect(new Set(controls).size).toBe(controls.length);

    // Two controls over one value is a page that contradicts itself after a
    // save, so the duplicates have to become references — but they must not
    // become silence: every key a behaviour reads still appears under it.
    for (const behavior of view.behaviors) {
      const spec = BEHAVIORS.find((b) => b.id === behavior.id);
      const shown = [...behavior.keys.map((k) => k.key), ...behavior.shared.map((s) => s.key)];
      expect(shown.sort()).toEqual([...(spec?.keys ?? [])].sort());
    }

    // `nudge_mode` is read by three hooks; only the first draws it.
    const nudge = view.behaviors.filter((b) => b.shared.some((s) => s.key === "nudge_mode"));
    expect(nudge.length).toBe(2);
    expect(nudge.every((b) => b.shared.some((s) => s.owner.length > 0))).toBe(true);
  });
});

describe("repair streams the child's output", () => {
  // The argv here is NOT one of the two real actions on purpose. Those rewrite
  // the install tree, which is not something a test should do to the checkout it
  // is running in — and the thing worth pinning is the plumbing: does the child's
  // stdout reach the response while it runs, and does the exit code survive a
  // status line that was already sent with the first chunk.
  it("writes stdout through and ends with the exit code", async () => {
    const chunks: string[] = [];
    const res = {
      writeHead: () => undefined,
      write: (c: Buffer) => chunks.push(c.toString("utf8")),
      end: (s: string) => chunks.push(s),
    } as unknown as ServerResponse;

    runRepair(
      {
        ok: true,
        action: "doctor-fix",
        argv: ["-e", "process.stdout.write('fabric 9.9.9\\n')"],
        cwd: process.cwd(),
      },
      res,
    );
    await vi.waitFor(() => expect(chunks.join("")).toMatch(/exited with code/u), { timeout: 15_000 });

    const out = chunks.join("");
    expect(out).toMatch(/\d+\.\d+\.\d+/u); // the child actually printed
    expect(out).toMatch(/\[fabric\] doctor-fix exited with code 0/u);
  }, 20_000);

  it("refuses every action name that is not in the table", () => {
    for (const bad of ["doctor", "Install", "install ", "../install", 42, null, undefined, {}]) {
      expect(isRepairAction(bad)).toBe(false);
    }
    expect(isRepairAction("install")).toBe(true);
    expect(isRepairAction("doctor-fix")).toBe(true);
  });
});

describe("machine scope", () => {
  it("returns no clients and no behaviours, because neither has a machine-wide answer", async () => {
    const view = await collectIntegrations({ kind: "machine" });
    expect(view).toMatchObject({
      scope: { kind: "machine", projectId: null, path: null },
      clients: [],
      behaviors: [],
    });
    // Strings still ship: the page renders the "pick a project" state from them.
    expect(view.strings["machine-only"]).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Fences over the one hand-written table on this page.
// ---------------------------------------------------------------------------

const PANEL_KEYS = getPanelFields().map((f) => String(f.key));
const PROJECT_SCOPED_KEYS = getPanelFields()
  // Corpus keys belong to a knowledge store, not to a project directory, and
  // resolving them against a project context would report the wrong value.
  .filter((f) => f.home !== "corpus")
  .map((f) => String(f.key));

describe("the behaviour registry cannot drift from the live registries", () => {
  it("names only hook scripts that are actually distributed", () => {
    const shipped = new Set(
      Object.values(HOOK_SCRIPT_DESTINATIONS).map((d) => {
        const rel = d[0] as string;
        return rel.slice(rel.lastIndexOf("/") + 1).replace(/\.cjs$/u, "");
      }),
    );
    expect(BEHAVIORS.map((b) => b.id).sort()).toEqual([...shipped].sort());
  });

  it("names only real panel keys", () => {
    const named = [
      ...BEHAVIORS.flatMap((b) => b.keys),
      ...NON_HOOK_KEYS,
      ...UNWIRED_BEHAVIOR_KEYS,
    ];
    expect(named.filter((key) => !PANEL_KEYS.includes(key))).toEqual([]);
  });

  it("accounts for EVERY project-scoped panel key exactly once", () => {
    // The load-bearing fence. Without it a key added to the schema simply would
    // not appear here and nobody would notice — which is how the four keys in
    // UNWIRED_BEHAVIOR_KEYS came to be shipped as working controls that no code
    // reads. Adding a field now forces a deliberate answer to "who reads this".
    const wired = [...new Set(BEHAVIORS.flatMap((b) => b.keys))];
    const classified = [...wired, ...NON_HOOK_KEYS, ...UNWIRED_BEHAVIOR_KEYS];

    expect(classified.filter((k) => !PROJECT_SCOPED_KEYS.includes(k))).toEqual([]);
    expect(PROJECT_SCOPED_KEYS.filter((k) => !classified.includes(k))).toEqual([]);
    expect(new Set(classified).size).toBe(classified.length);
  });

  it("every distribution destination lives under a known client directory", () => {
    // The payload derives a file's client from its path prefix rather than from
    // its position in the destination array. That is only safe while every
    // destination carries one of the two prefixes.
    const clientDirs = Object.values(HOOK_REGISTRATIONS).map((l) => `${l.clientDir}/`);
    const everyDestination = [
      ...Object.values(HOOK_SCRIPT_DESTINATIONS).flat(),
      ...Object.values(SKILL_DESTINATIONS).flat(),
      ...HOOK_LIB_DESTINATIONS,
      ...SKILL_LIB_DESTINATIONS,
    ];
    expect(everyDestination.filter((d) => !clientDirs.some((p) => d.startsWith(p)))).toEqual([]);
  });
});
