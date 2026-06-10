import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoctorCheck } from "./doctor.js";
import { runDoctorReport } from "./doctor.js";
import { writeKnowledgeMeta } from "./knowledge-meta-builder.js";

const tempRoots: string[] = [];

let originalFabricHome: string | undefined;
let originalFabLang: string | undefined;
let fakeHome: string;

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  fakeHome = mkdtempSync(join(tmpdir(), "doctor-i18n-fabric-home-"));
  tempRoots.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;

  originalFabLang = process.env.FAB_LANG;
  process.env.FAB_LANG = "en";
});

// grill-6fixes (D1): doctor renders in the single machine-wide language tone
// from ~/.fabric/fabric-global.json, not a per-project field. Drive it by
// writing the global config under the isolated FABRIC_HOME.
function setGlobalLanguage(language: "en" | "zh-CN"): void {
  const dir = join(fakeHome, ".fabric");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "fabric-global.json"),
    JSON.stringify({ uid: "u-doctor-i18n", language, stores: [] }, null, 2),
    "utf8",
  );
}

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

describe("runDoctorReport i18n snapshots", () => {
  it("renders stable English doctor checks from global language=en", async () => {
    const target = createV2KnowledgeProject("doctor-i18n-en");
    setGlobalLanguage("en");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

    const report = await runDoctorReport(target);

    expect(projectChecks(report.checks)).toMatchSnapshot();
  });

  it("renders stable Chinese doctor checks from global language=zh-CN", async () => {
    const target = createV2KnowledgeProject("doctor-i18n-zh");
    setGlobalLanguage("zh-CN");
    await writeKnowledgeMeta(target, { source: "doctor_fix" });

    const report = await runDoctorReport(target);

    expect(projectChecks(report.checks)).toMatchSnapshot();
  });

  it("keeps doctor check ordering and machine fields locale-invariant", async () => {
    const enTarget = createV2KnowledgeProject("doctor-i18n-contract-en");
    await writeKnowledgeMeta(enTarget, { source: "doctor_fix" });

    const zhTarget = createV2KnowledgeProject("doctor-i18n-contract-zh");
    await writeKnowledgeMeta(zhTarget, { source: "doctor_fix" });

    // grill-6fixes (D1): language is global now, so flip the global tone
    // between the two runs to compare en vs zh rendering of the same checks.
    setGlobalLanguage("en");
    const enReport = await runDoctorReport(enTarget);
    setGlobalLanguage("zh-CN");
    const zhReport = await runDoctorReport(zhTarget);

    expect(zhReport.checks).toHaveLength(enReport.checks.length);
    expect(invariantChecks(zhReport.checks)).toEqual(invariantChecks(enReport.checks));
    expect(zhReport.checks.map((check) => check.name)).not.toEqual(
      enReport.checks.map((check) => check.name),
    );
  });
});

function projectChecks(checks: DoctorCheck[]): Array<{
  name: string;
  status: DoctorCheck["status"];
  code: string | null;
  kind: DoctorCheck["kind"] | null;
  message_prefix_30_chars: string;
  actionHint_prefix_30_chars: string | null;
}> {
  return checks.map((check) => ({
    name: check.name,
    status: check.status,
    code: check.code ?? null,
    kind: check.kind ?? null,
    message_prefix_30_chars: check.message.slice(0, 30),
    actionHint_prefix_30_chars: check.actionHint?.slice(0, 30) ?? null,
  }));
}

function invariantChecks(checks: DoctorCheck[]): Array<{
  index: number;
  status: DoctorCheck["status"];
  code: string | null;
  kind: DoctorCheck["kind"] | null;
}> {
  return checks.map((check, index) => ({
    index,
    status: check.status,
    code: check.code ?? null,
    kind: check.kind ?? null,
  }));
}

function createV2KnowledgeProject(name: string): string {
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
  // grill-6fixes (D1): a minimal project config (no per-project language — that
  // is global now). Kept so doctor's project-config checks stay satisfied.
  writeFile(".fabric/fabric-config.json", JSON.stringify({}, null, 2), target);
  return target;
}

function createProject(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
}

function writeFile(path: string, content: string, root: string): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `${content.endsWith("\n") ? content : `${content}\n`}`, "utf8");
}

function createForensic(target: string, name: string): unknown {
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
