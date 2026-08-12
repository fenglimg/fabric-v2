import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error -- plain .mjs build script, no type declarations by design.
import { checkLines } from "../../../scripts/doc-drift-gate.mjs";
// @ts-expect-error -- plain .mjs build script, no type declarations by design.
import { BOLD_VERSION_RE, rewriteVersionClaims } from "../../../scripts/lib/version-claim.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const APPLY_SCRIPT = path.join(REPO_ROOT, "scripts", "apply-tag-version.mjs");

/**
 * Deliberately nothing this repo could ever be at. KT-PIT-0062: an assertion
 * whose expected value collides with the real/default one passes without ever
 * exercising the behaviour under test.
 */
const FAKE_VERSION = "9.9.9-rc.7";

const tempDirs: string[] = [];

function makeFixtureRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fabric-bump-"));
  tempDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const target = path.join(dir, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("rewriteVersionClaims", () => {
  it("rewrites the version token and preserves the rest of the line byte-for-byte", () => {
    const source = "**v2.5.0-rc.3** —— 活跃开发线。升级说明见 [docs/UPGRADE.md](./docs/UPGRADE.md)。\n";
    const { content, claims } = rewriteVersionClaims(source, "2.5.0-rc.4");

    expect(content).toBe(
      "**v2.5.0-rc.4** —— 活跃开发线。升级说明见 [docs/UPGRADE.md](./docs/UPGRADE.md)。\n",
    );
    expect(claims).toEqual([
      { line: 1, previous: "2.5.0-rc.3", next: "2.5.0-rc.4", changed: true },
    ]);
  });

  it("preserves list / blockquote markers ahead of the claim", () => {
    const { content } = rewriteVersionClaims("- **v1.0.0-beta.1** active\n", FAKE_VERSION);
    expect(content).toBe(`- **v${FAKE_VERSION}** active\n`);

    const quoted = rewriteVersionClaims("> **v1.0.0** active\n", FAKE_VERSION);
    expect(quoted.content).toBe(`> **v${FAKE_VERSION}** active\n`);
  });

  it("leaves an already-current claim untouched and reports it as unchanged", () => {
    const source = `**v${FAKE_VERSION}** active\n`;
    const { content, claims } = rewriteVersionClaims(source, FAKE_VERSION);

    expect(content).toBe(source);
    expect(claims).toEqual([
      { line: 1, previous: FAKE_VERSION, next: FAKE_VERSION, changed: false },
    ]);
  });

  it("does NOT touch an inline version — prose recounting history is not a claim", () => {
    const source = "Isolated back in v2.0.0-rc.37 — historical prose.\n**v1.0.0** active\n";
    const { content, claims } = rewriteVersionClaims(source, FAKE_VERSION);

    expect(content).toContain("Isolated back in v2.0.0-rc.37 — historical prose.");
    expect(claims).toHaveLength(1);
    expect(claims[0].line).toBe(2);
  });

  it("throws rather than silently no-op when the doc states no version at all", () => {
    expect(() => rewriteVersionClaims("Just prose.\n", FAKE_VERSION, "README.md")).toThrow(
      /no line-leading \*\*vX\.Y\.Z\*\* version claim/,
    );
  });
});

describe("bump ↔ doc-drift-gate round trip", () => {
  // The producer (rewriteVersionClaims) and the consumer (checkLines) must agree
  // on what a version claim is. Asserting each in isolation would pass even if
  // they disagreed — only feeding one's output to the other catches that.
  const truth = (version: string) => ({
    version,
    liveCommands: new Set<string>(),
    retiredCommands: new Set<string>(),
    eventTypes: new Set<string>(),
  });

  const versionDrift = (lines: string[], version: string) => {
    const { violations, coverage } = checkLines("README.md", lines, truth(version));
    return {
      drift: violations.filter((v: { code: string }) => v.code === "version_drift"),
      versionClaims: coverage.versionClaims,
    };
  };

  it("shares one regex with the gate (no second copy to drift)", () => {
    expect(BOLD_VERSION_RE.source).toContain("\\*\\*v");
  });

  it("the real README, bumped, satisfies the gate's version check", () => {
    const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
    const { content } = rewriteVersionClaims(readme, FAKE_VERSION, "README.md");

    const after = versionDrift(content.split("\n"), FAKE_VERSION);
    expect(after.versionClaims).toBe(1);
    expect(after.drift).toEqual([]);
  });

  it("negative control: the same README un-bumped IS reported as drifted", () => {
    // Without this, the assertion above would also pass if checkLines had
    // regressed to returning [] unconditionally.
    const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");

    const before = versionDrift(readme.split("\n"), FAKE_VERSION);
    expect(before.versionClaims).toBe(1);
    expect(before.drift).toHaveLength(1);
    expect(before.drift[0].code).toBe("version_drift");
  });
});

describe("apply-tag-version.mjs", () => {
  const MANIFEST = (name: string) =>
    `${JSON.stringify({ name, version: "0.0.1", private: false }, null, 2)}\n`;

  it("bumps README's version claim alongside every package manifest", () => {
    const dir = makeFixtureRepo({
      "package.json": MANIFEST("fabric-root"),
      "packages/cli/package.json": MANIFEST("@fenglimg/fabric-cli"),
      "packages/shared/package.json": MANIFEST("@fenglimg/fabric-shared"),
      "README.md": "# Fabric\n\n## 状态\n\n**v0.0.1** —— 活跃开发线。\n\n仓库：https://example.com\n",
    });

    execFileSync("node", [APPLY_SCRIPT, `v${FAKE_VERSION}`], { cwd: dir, encoding: "utf8" });

    for (const manifest of ["package.json", "packages/cli/package.json", "packages/shared/package.json"]) {
      expect(JSON.parse(readFileSync(path.join(dir, manifest), "utf8")).version).toBe(FAKE_VERSION);
    }

    const readme = readFileSync(path.join(dir, "README.md"), "utf8");
    expect(readme).toContain(`**v${FAKE_VERSION}** —— 活跃开发线。`);
    // Untouched prose stays untouched.
    expect(readme).toContain("仓库：https://example.com");
    // And the README now agrees with the manifest — the invariant CI enforces.
    const claim = readme.split("\n").map((l) => BOLD_VERSION_RE.exec(l)).find(Boolean);
    expect(claim![1]).toBe(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version);
  });

  it("fails loudly when README carries no version claim to bump", () => {
    const dir = makeFixtureRepo({
      "package.json": MANIFEST("fabric-root"),
      "packages/cli/package.json": MANIFEST("@fenglimg/fabric-cli"),
      "README.md": "# Fabric\n\nNo version stated anywhere.\n",
    });

    expect(() =>
      execFileSync("node", [APPLY_SCRIPT, `v${FAKE_VERSION}`], { cwd: dir, stdio: "pipe" }),
    ).toThrow(/no line-leading \*\*vX\.Y\.Z\*\* version claim/);
  });
});
