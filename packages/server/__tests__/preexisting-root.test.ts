/**
 * preexisting-root.test.ts — TASK-034
 *
 * Verifies detection of pre-existing CLAUDE.md / AGENTS.md at project root:
 *   1. formatPreexistingRootMessage helper unit tests (startup log path)
 *   2. runDoctorReport doctor check (preexisting_root_claude_md)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatPreexistingRootMessage } from "../src/index.js";
import { runDoctorReport } from "../src/services/doctor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "fabric-preexisting-root-"));
}

// ---------------------------------------------------------------------------
// Unit tests: formatPreexistingRootMessage
// ---------------------------------------------------------------------------

describe("formatPreexistingRootMessage — startup helper (TASK-034)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  function makeTmp(): string {
    const dir = makeTempRoot();
    tempDirs.push(dir);
    return dir;
  }

  it("returns null when neither CLAUDE.md nor AGENTS.md exists", () => {
    const root = makeTmp();
    expect(formatPreexistingRootMessage(root)).toBeNull();
  });

  it("returns info message when CLAUDE.md is present", () => {
    const root = makeTmp();
    writeFileSync(join(root, "CLAUDE.md"), "# Claude instructions\n", "utf8");
    const msg = formatPreexistingRootMessage(root);
    expect(msg).not.toBeNull();
    expect(msg).toContain("CLAUDE.md");
    expect(msg).toContain("[startup] info:");
    expect(msg).toContain(".fabric/rules/");
  });

  it("returns info message when AGENTS.md is present", () => {
    const root = makeTmp();
    writeFileSync(join(root, "AGENTS.md"), "# Agents instructions\n", "utf8");
    const msg = formatPreexistingRootMessage(root);
    expect(msg).not.toBeNull();
    expect(msg).toContain("AGENTS.md");
    expect(msg).toContain("[startup] info:");
  });

  it("lists both filenames when both are present", () => {
    const root = makeTmp();
    writeFileSync(join(root, "CLAUDE.md"), "# Claude instructions\n", "utf8");
    writeFileSync(join(root, "AGENTS.md"), "# Agents instructions\n", "utf8");
    const msg = formatPreexistingRootMessage(root);
    expect(msg).not.toBeNull();
    expect(msg).toContain("CLAUDE.md");
    expect(msg).toContain("AGENTS.md");
  });
});

// ---------------------------------------------------------------------------
// Integration tests: runDoctorReport preexisting_root_claude_md check
// ---------------------------------------------------------------------------

describe("runDoctorReport — preexisting root markdown check (TASK-034)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  function makeTmp(): string {
    const dir = makeTempRoot();
    tempDirs.push(dir);
    return dir;
  }

  it("returns no preexisting_root_claude_md info when neither file exists", async () => {
    const root = makeTmp();
    const report = await runDoctorReport(root);
    const infoFinding = report.infos.find((i) => i.code === "preexisting_root_claude_md");
    expect(infoFinding).toBeUndefined();
  });

  it("returns info-level finding when CLAUDE.md is present", async () => {
    const root = makeTmp();
    writeFileSync(join(root, "CLAUDE.md"), "# Claude instructions\n", "utf8");
    const report = await runDoctorReport(root);
    const infoFinding = report.infos.find((i) => i.code === "preexisting_root_claude_md");
    expect(infoFinding).toBeDefined();
    expect(infoFinding?.message).toContain("CLAUDE.md");
  });

  it("returns info-level finding when AGENTS.md is present", async () => {
    const root = makeTmp();
    writeFileSync(join(root, "AGENTS.md"), "# Agents instructions\n", "utf8");
    const report = await runDoctorReport(root);
    const infoFinding = report.infos.find((i) => i.code === "preexisting_root_claude_md");
    expect(infoFinding).toBeDefined();
    expect(infoFinding?.message).toContain("AGENTS.md");
  });

  it("lists both filenames in the finding when both are present", async () => {
    const root = makeTmp();
    writeFileSync(join(root, "CLAUDE.md"), "# Claude instructions\n", "utf8");
    writeFileSync(join(root, "AGENTS.md"), "# Agents instructions\n", "utf8");
    const report = await runDoctorReport(root);
    const infoFinding = report.infos.find((i) => i.code === "preexisting_root_claude_md");
    expect(infoFinding).toBeDefined();
    expect(infoFinding?.message).toContain("CLAUDE.md");
    expect(infoFinding?.message).toContain("AGENTS.md");
  });

  it("info finding does not affect overall doctor status (status stays non-error)", async () => {
    const root = makeTmp();
    writeFileSync(join(root, "CLAUDE.md"), "# Claude instructions\n", "utf8");
    const report = await runDoctorReport(root);
    // The preexisting check is ok-status; it must not push status to 'error'
    // (other checks may push status to error/warn, but not this one alone)
    const preexistingCheck = report.checks.find((c) => c.code === "preexisting_root_claude_md");
    expect(preexistingCheck).toBeDefined();
    expect(preexistingCheck?.status).toBe("ok");
    expect(preexistingCheck?.kind).toBe("info");
    expect(preexistingCheck?.fixable).toBe(false);
  });
});
