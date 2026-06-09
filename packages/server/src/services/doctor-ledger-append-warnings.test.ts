import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./event-ledger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./event-ledger.js")>();
  return {
    ...actual,
    appendEventLedgerEvent: vi.fn(async () => {
      throw new Error("ledger append unavailable");
    }),
  };
});

const { runDoctorApplyLint, runDoctorFix } = await import("./doctor.js");

const tempRoots: string[] = [];
let originalFabricHome: string | undefined;
let originalFabLang: string | undefined;

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = mkdtempSync(join(tmpdir(), "doctor-ledger-warn-home-"));
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

function createProject(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `${content.endsWith("\n") ? content : `${content}\n`}`, "utf8");
}

function createInitializedProject(name: string): string {
  const target = createProject(name);
  writeFile(target, "package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }, null, 2));
  writeFile(target, "src/main.ts", "export const boot = true;\n");
  writeFile(target, "AGENTS.md", "# AGENTS\nFabric v2 bootstrap anchor.\n");
  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    mkdirSync(join(target, ".fabric", "knowledge", sub), { recursive: true });
  }
  writeFile(target, ".fabric/forensic.json", JSON.stringify({ version: "1.0", generated_at: "2026-04-26T00:00:00.000Z" }, null, 2));
  writeFile(target, ".fabric/events.jsonl", "");
  return target;
}

function seedStaleServeLock(target: string): void {
  const acquiredAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
  writeFile(target, ".fabric/.serve.lock", JSON.stringify({ pid: 99999999, acquiredAt, host: "test-host" }));
}

describe("doctor mutation ledger append warnings", () => {
  it("runDoctorFix surfaces a non-fatal warning when a best-effort ledger append fails", async () => {
    const target = createInitializedProject("doctor-fix-ledger-warning");
    seedStaleServeLock(target);

    const report = await runDoctorFix(target);

    expect(report.fixed.map((issue) => issue.code)).toContain("stale_serve_lock");
    expect(report.warnings.map((warning) => warning.code)).toContain("event_ledger_append_failed");
    expect(report.report.warnings.map((warning) => warning.code)).toContain("event_ledger_append_failed");
    expect(report.warnings.find((warning) => warning.code === "event_ledger_append_failed")?.message).toContain(
      "stale serve lock cleanup",
    );
  });

  it("runDoctorApplyLint surfaces a non-fatal warning when the aggregate ledger event fails", async () => {
    const target = createInitializedProject("doctor-apply-lint-ledger-warning");

    const report = await runDoctorApplyLint(target);

    expect(report.aborted).toBe(false);
    expect(report.warnings.map((warning) => warning.code)).toContain("event_ledger_append_failed");
    expect(report.report.warnings.map((warning) => warning.code)).toContain("event_ledger_append_failed");
    expect(report.warnings.find((warning) => warning.code === "event_ledger_append_failed")?.message).toContain(
      "relevance migration aggregate event",
    );
  });
});
