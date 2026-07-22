import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PROJECT_CONTEXT_MATRIX } from "../../../shared/test/fixtures/project-context-matrix.js";
import {
  createGitWorktreeFixture,
  fixtureRoot,
  type GitWorktreeFixture,
} from "../../../shared/test/helpers/git-worktree-fixture.js";
import { installMcpClients } from "../../src/commands/config.js";
import type { McpRootPolicy } from "../../src/config/writer.js";

type Fingerprint = { exists: false } | { exists: true; mtimeMs: number; size: number; sha256: string };

const realHome = homedir();
const realHomePaths = [
  join(realHome, ".claude.json"),
  join(realHome, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  join(realHome, ".codex", "config.toml"),
  join(realHome, ".fabric", "fabric-global.json"),
];
const tempRoots: string[] = [];
const fixtures: GitWorktreeFixture[] = [];
let originalHome: string | undefined;
let originalFabricHome: string | undefined;

function fingerprint(path: string): Fingerprint {
  if (!existsSync(path)) return { exists: false };
  const stat = statSync(path);
  return {
    exists: true,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

function matrixHome(): { home: string; fabricHome: string } {
  const root = mkdtempSync(join(tmpdir(), "fabric-client-matrix-"));
  tempRoots.push(root);
  const home = join(root, "home");
  const fabricHome = join(root, "fabric-home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  mkdirSync(fabricHome, { recursive: true });
  return { home, fabricHome };
}

beforeAll(() => {
  originalHome = process.env.HOME;
  originalFabricHome = process.env.FABRIC_HOME;
});

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse()) fixture.cleanup();
  for (const root of tempRoots.splice(0).reverse()) rmSync(root, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
});

describe.sequential("MCP client configuration matrix with isolated HOME/FABRIC_HOME", () => {
  for (const testCase of PROJECT_CONTEXT_MATRIX) {
    it(`${testCase.name} writes only the isolated target`, async () => {
      const realHomeBefore = realHomePaths.map(fingerprint);
      const { home, fabricHome } = matrixHome();
      process.env.HOME = home;
      process.env.FABRIC_HOME = fabricHome;

      const fixture = createGitWorktreeFixture();
      fixtures.push(fixture);
      fixture.configureLinkedBinding(testCase.workspaceBinding);
      const desktopConfig = join(home, "desktop", "claude_desktop_config.json");
      const codexConfig = join(home, ".codex", "config.toml");
      writeFileSync(
        join(fixture.main, ".fabric", "fabric-config.json"),
        `${JSON.stringify({
          project_id: "11111111-1111-4111-8111-111111111111",
          clientPaths: {
            claudeCodeDesktop: desktopConfig,
            codexCLI: codexConfig,
          },
        }, null, 2)}\n`,
        "utf8",
      );

      const pinnedRoot = fixtureRoot(fixture, testCase.explicitRoot ?? "main");
      const mcpRootPolicy: McpRootPolicy = testCase.rootMode === "dynamic"
        ? { mode: "dynamic" }
        : { mode: "pinned", projectRoot: pinnedRoot, provenance: "operator" };
      const result = await installMcpClients(fixture.main, {
        clients: [testCase.client.kind],
        claudeMcpScope: testCase.client.claudeScope,
        localServerPath: join(fabricHome, "server.js"),
        mcpRootPolicy,
      });

      expect(result.installed).toEqual([testCase.client.kind]);
      const configPath = result.details[0]?.path;
      expect(configPath).toBeTruthy();
      const raw = readFileSync(configPath!, "utf8");
      if (testCase.rootMode === "dynamic") {
        expect(raw).not.toContain("FABRIC_PROJECT_ROOT");
        expect(raw).not.toContain("FABRIC_PROJECT_ROOT_PROVENANCE");
      } else {
        expect(raw).toContain("FABRIC_PROJECT_ROOT");
        expect(raw).toContain(pinnedRoot);
        expect(raw).toContain("operator:v1");
      }

      const expectedPath = testCase.client.kind === "ClaudeCodeCLI"
        ? testCase.client.claudeScope === "user"
          ? join(home, ".claude.json")
          : join(fixture.main, ".mcp.json")
        : testCase.client.kind === "ClaudeCodeDesktop"
          ? desktopConfig
          : codexConfig;
      expect(configPath).toBe(expectedPath);
      expect(process.env.HOME).toBe(home);
      expect(process.env.FABRIC_HOME).toBe(fabricHome);
      expect(realHomePaths.map(fingerprint)).toEqual(realHomeBefore);
    });
  }
});
