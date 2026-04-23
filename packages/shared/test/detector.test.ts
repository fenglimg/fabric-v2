import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { detectFramework } from "../src/detector";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe("detectFramework", () => {
  it("detects Cocos Creator from project.config.json", () => {
    const root = makeTempProject("fabric-detector-project-config");

    writeFileSync(
      join(root, "project.config.json"),
      JSON.stringify({ creator: { version: "3.8.0" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(root, "tsconfig.json"), "{\n}\n", "utf8");

    expect(detectFramework(root)).toEqual({
      kind: "cocos-creator",
      version: "3.8.0",
      subkind: "typescript-component",
      evidence: ["project.config.json: creator.version=3.8.0"],
      framework: "cocos-creator",
      confidence: "HIGH",
      ast_evidence: [],
      co_packages: ["tsconfig.json"],
    });
  });

  it("detects Cocos Creator from package.json creator.version when project.config.json is absent", () => {
    const root = makeTempProject("fabric-detector-package-json");

    mkdirSync(join(root, "assets", "script"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(
        {
          name: "oops-framework",
          creator: {
            version: "3.8.7",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(join(root, "tsconfig.json"), "{\n}\n", "utf8");
    writeFileSync(join(root, "assets", "script", "Main.ts"), "export {};\n", "utf8");

    expect(detectFramework(root)).toEqual({
      kind: "cocos-creator",
      version: "3.8.7",
      subkind: "typescript-component",
      evidence: ["package.json: creator.version=3.8.7"],
      framework: "cocos-creator",
      confidence: "HIGH",
      ast_evidence: [],
      co_packages: ["tsconfig.json"],
    });
  });

  it("returns a structured TechProfile for package-detected web frameworks", () => {
    const root = makeTempProject("fabric-detector-react-profile");

    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(detectFramework(root)).toMatchObject({
      kind: "react",
      framework: "react",
      confidence: "HIGH",
      ast_evidence: [],
      co_packages: ["react-dom"],
    });
  });
});

function makeTempProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(root);
  return root;
}
