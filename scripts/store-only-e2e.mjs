#!/usr/bin/env node
/**
 * Store-only release gate.
 *
 * Runs against built artifacts, not TS sources:
 *   - packages/cli/dist/index.js for the public CLI/bin surface.
 *   - packages/server/dist/index.js for the exported MCP service core.
 *
 * The fixture is fully local and disposable: isolated FABRIC_HOME, temp project
 * root, local store created through the CLI, and no network remotes.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const CLI_PATH = join(REPO_ROOT, "packages/cli/dist/index.js");
const SERVER_PATH = join(REPO_ROOT, "packages/server/dist/index.js");
const SHARED_PATH = join(REPO_ROOT, "packages/shared/dist/index.js");

const TEAM_STORE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function fail(message, detail = "") {
  const suffix = detail.length > 0 ? `\n${detail}` : "";
  throw new Error(`[store-only-e2e] ${message}${suffix}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runCli(args, options) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(
      `CLI failed: fabric ${args.join(" ")}`,
      [`status=${result.status}`, result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
  }
  return result;
}

function ensureBuiltArtifacts() {
  for (const path of [CLI_PATH, SERVER_PATH, SHARED_PATH]) {
    if (!existsSync(path)) {
      fail(`missing built artifact: ${path}`, "Run `pnpm -r build` first.");
    }
  }
}

function writeInitialGlobalConfig(fabricHome) {
  const globalRoot = join(fabricHome, ".fabric");
  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(
    join(globalRoot, "fabric-global.json"),
    `${JSON.stringify({ uid: "store-only-e2e", stores: [] }, null, 2)}\n`,
    "utf8",
  );
}

function writeProjectConfig(projectRoot) {
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(
      {
        project_id: "11111111-1111-4111-8111-111111111111",
        active_project: "fabric-v2",
        required_stores: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
}

async function main() {
  ensureBuiltArtifacts();

  const root = mkdtempSync(join(tmpdir(), "fabric-store-only-e2e-"));
  const fabricHome = join(root, "home");
  const projectRoot = join(root, "project");
  mkdirSync(projectRoot, { recursive: true });

  const env = {
    ...process.env,
    FABRIC_HOME: fabricHome,
    FABRIC_PROJECT_ROOT: projectRoot,
    NO_COLOR: "1",
  };
  const priorFabricHome = process.env.FABRIC_HOME;
  const priorProjectRoot = process.env.FABRIC_PROJECT_ROOT;

  try {
    process.env.FABRIC_HOME = fabricHome;
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    writeInitialGlobalConfig(fabricHome);
    writeProjectConfig(projectRoot);

    const help = runCli(["--help"], { cwd: projectRoot, env });
    assert(help.stdout.includes("fabric"), "root --help did not render the fabric CLI");
    const version = runCli(["--version"], { cwd: projectRoot, env });
    assert(version.stdout.trim().length > 0, "root --version did not print a version");

    runCli(["store", "create", "--alias", "team", "--mount-name", "team"], {
      cwd: projectRoot,
      env,
    });
    const globalConfig = readJson(join(fabricHome, ".fabric", "fabric-global.json"));
    const team = globalConfig.stores.find((store) => store.alias === "team");
    assert(team !== undefined, "CLI store create did not mount team store");
    assert(TEAM_STORE_UUID_PATTERN.test(team.store_uuid), "team store UUID is invalid");
    assert(team.mount_name === "team", "team store mount_name should be stable for the gate");

    runCli(["store", "project", "create", "team", "fabric-v2"], { cwd: projectRoot, env });
    runCli(["store", "bind", "team", "--project", "fabric-v2"], { cwd: projectRoot, env });
    runCli(["store", "switch-write", "team"], { cwd: projectRoot, env });
    runCli(["store", "route-write", "project:fabric-v2", "team"], { cwd: projectRoot, env });

    const projectConfig = readJson(join(projectRoot, ".fabric", "fabric-config.json"));
    assert(
      projectConfig.required_stores?.some((store) => store.id === "team") === true,
      "store bind did not persist required_stores",
    );
    assert(projectConfig.active_project === "fabric-v2", "store bind did not persist active_project");
    assert(projectConfig.active_write_store === "team", "switch-write did not persist active_write_store");
    assert(
      projectConfig.write_routes?.some(
        (route) => route.scope === "project:fabric-v2" && route.store === "team",
      ) === true,
      "route-write did not persist project:fabric-v2 -> team",
    );

    const server = await import(pathToFileURL(SERVER_PATH).href);
    const shared = await import(pathToFileURL(SHARED_PATH).href);
    server.contextCache?.invalidate?.("file_watch");

    const extracted = await server.extractKnowledge(projectRoot, {
      source_sessions: ["store-only-e2e"],
      recent_paths: [],
      user_messages_summary:
        "Store-only E2E verifies pending, promote, and recall stay inside the mounted team store.",
      type: "decisions",
      slug: "store-only-e2e-roundtrip",
      layer: "team",
      semantic_scope: "project:fabric-v2",
      proposed_reason: "diagnostic-then-fix",
      session_context:
        "CI gate: built CLI configures a mounted store; built server writes, approves, and recalls it.",
    });
    assert(extracted.pending_path.length > 0, "extractKnowledge did not return a pending path");
    assert(
      extracted.pending_path.includes(`${shared.STORE_LAYOUT.knowledgeDir}/${shared.STORE_PENDING_DIR}/decisions`),
      "pending path is not inside store knowledge/pending/decisions",
    );

    const listed = await server.reviewKnowledge(projectRoot, { action: "list" });
    assert(listed.action === "list", "review list returned wrong action");
    const pendingItem = listed.items.find((item) => item.pending_path === extracted.pending_path);
    assert(pendingItem !== undefined, "review list did not surface store-routed pending entry");

    const approved = await server.reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingItem.pending_path],
    });
    assert(approved.action === "approve", "review approve returned wrong action");
    assert(approved.approved.length === 1, "review approve did not approve exactly one entry");
    const stableId = approved.approved[0].stable_id;

    // Two-layer store layout (grill-6fixes D4): stores/<group>/<label>, where
    // group = personal|team bucket and label = mount_name. Derive the store root
    // the same way production does (storeRelativePathForMount) instead of
    // hardcoding stores/team — the mounted team store physically lives at
    // stores/team/team here (group=team, mount_name=team).
    const storeRoot = join(fabricHome, ".fabric", shared.storeRelativePathForMount(team));
    const canonicalDir = join(storeRoot, shared.STORE_LAYOUT.knowledgeDir, "decisions");
    const canonicalFiles = listMarkdown(canonicalDir);
    assert(canonicalFiles.length === 1, "canonical decision was not written to the team store");
    const canonicalBody = readFileSync(join(canonicalDir, canonicalFiles[0]), "utf8");
    assert(canonicalBody.includes(`id: ${stableId}`), "canonical entry missing approved stable id");
    assert(
      /^semantic_scope: project:fabric-v2$/mu.test(canonicalBody),
      "canonical entry missing project semantic_scope",
    );
    assert(
      /^visibility_store: "team"$/mu.test(canonicalBody),
      "canonical entry missing team visibility_store",
    );

    const projectKnowledgeRoot = join(projectRoot, ".fabric", "knowledge");
    assert(!existsSync(projectKnowledgeRoot), "store-only E2E created retired project .fabric/knowledge");

    server.contextCache?.invalidate?.("file_watch");
    const recalled = await server.recall(projectRoot, {
      paths: ["src/store-only-e2e.ts"],
      intent: "store-only mounted store roundtrip",
      ids: [`team:${stableId}`],
      session_id: "store-only-e2e",
      correlation_id: "store-only-e2e",
    });
    // Lean recall (KT-DEC-0026): the old `selected_stable_ids` / `rules[]`
    // fields were removed. The surfaced store-qualified id now lives in
    // `paths[]` (the read-path index, scoped to the caller's `ids`), each entry
    // carrying the on-disk read path + originating store alias.
    const recalledPath = recalled.paths.find((p) => p.stable_id === `team:${stableId}`);
    assert(
      recalledPath !== undefined,
      "recall did not surface the approved store-qualified id in paths[]",
    );
    assert(
      recalledPath.store?.alias === "team",
      "recalled path is not attributed to the team store",
    );

    process.stdout.write(
      JSON.stringify(
        {
          schema_version: 1,
          verdict: "pass",
          project_root: projectRoot,
          fabric_home: fabricHome,
          store_alias: "team",
          stable_id: `team:${stableId}`,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    if (priorFabricHome === undefined) {
      delete process.env.FABRIC_HOME;
    } else {
      process.env.FABRIC_HOME = priorFabricHome;
    }
    if (priorProjectRoot === undefined) {
      delete process.env.FABRIC_PROJECT_ROOT;
    } else {
      process.env.FABRIC_PROJECT_ROOT = priorProjectRoot;
    }
    if (process.env.FABRIC_E2E_KEEP_TEMP !== "1") {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
