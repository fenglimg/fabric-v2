import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";

export const tempRoots: string[] = [];
let originalFabricHome: string | undefined;
let originalFabLang: string | undefined;

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = mkdtempSync(join(tmpdir(), "doctor-fabric-home-"));
  tempRoots.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  originalFabLang = process.env.FAB_LANG;
  process.env.FAB_LANG = "en";
});

afterEach(() => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  if (originalFabLang === undefined) {
    delete process.env.FAB_LANG;
  } else {
    process.env.FAB_LANG = originalFabLang;
  }
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

export function createProject(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
}

export function writeFile(path: string, content: string, root: string): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `${content.endsWith("\n") ? content : `${content}\n`}`, "utf8");
}

export function createForensic(target: string, name: string): unknown {
  return {
    version: "1.0",
    generated_at: new Date("2026-04-26T00:00:00.000Z").toISOString(),
    generated_by: "vitest",
    target,
    project_name: name,
    framework: {
      kind: "vite",
      version: "^7.0.0",
      subkind: "vite-application",
      evidence: ["package.json dependency: vite@^7.0.0"],
    },
    topology: {
      total_files: 3,
      by_ext: { ".json": 1, ".md": 2, ".ts": 2 },
      key_dirs: ["src"],
      max_depth: 2,
    },
    entry_points: [{ path: "src/main.ts", reason: "application entry", size_bytes: 26 }],
    code_samples: [],
    assertions: [],
    candidate_files: [],
    sampling_budget: { max_files: 15, max_lines_per_file: 100 },
    readme: { quality: "missing", line_count: 0, has_contributing: false },
    recommendations_for_skill: [],
  };
}

export function createInitializedProject(name: string): string {
  const target = createProject(name);
  writeFile("package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }, null, 2), target);
  writeFile("src/main.ts", "export const boot = true;\n", target);

  // v2.0 bootstrap anchor at the repo root (AGENTS.md or CLAUDE.md is sufficient).
  writeFile("AGENTS.md", "# AGENTS\nFabric v2.0 bootstrap anchor.\n", target);

  // v2.0 knowledge layout — six required subdirectories.
  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    mkdirSync(join(target, ".fabric", "knowledge", sub), { recursive: true });
  }

  writeFile(".fabric/init-context.json", JSON.stringify({ confirmed: true }, null, 2), target);
  writeFile(".fabric/forensic.json", JSON.stringify(createForensic(target, name), null, 2), target);
  // v2/rc.2: seed a knowledge entry under .fabric/knowledge/ so knowledge-meta-builder
  // has something to index. The legacy `.fabric/rules/` tree is no longer scanned.
  writeFile(".fabric/knowledge/decisions/server.md", "<!-- fab:rule-id rules/server -->\n# Server\n\n## [MANDATORY_INJECTION]\nUse services.\n", target);
  writeFile("packages/server/rules.contract.test.ts", "// @fabric-verify rules/server\nexpect(true).toBe(true);\n", target);
  return target;
}

export function createV2KnowledgeProject(name: string): string {
  const target = createProject(name);
  writeFile("package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }, null, 2), target);
  writeFile("src/main.ts", "export const boot = true;\n", target);
  writeFile("AGENTS.md", "# AGENTS\n", target);

  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    mkdirSync(join(target, ".fabric", "knowledge", sub), { recursive: true });
  }

  writeFile(".fabric/init-context.json", JSON.stringify({ confirmed: true }, null, 2), target);
  writeFile(".fabric/forensic.json", JSON.stringify(createForensic(target, name), null, 2), target);
  writeFile(".fabric/events.jsonl", "", target);
  // v2.2 store-only cutover: the co-location agents.meta.json / knowledge-test
  // index build path is retired, so the fixture seeds only the .fabric tree above.
  return target;
}
