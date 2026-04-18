import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type FrameworkInfo = {
  kind:
    | "vite"
    | "next"
    | "react"
    | "vue"
    | "cocos-creator"
    | "rust"
    | "python"
    | "unknown";
  evidence: string[];
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export function detectFramework(root: string): FrameworkInfo {
  const evidence: string[] = [];

  if (existsSync(join(root, "project.config.json"))) {
    return {
      kind: "cocos-creator",
      evidence: ["project.config.json"],
    };
  }

  const packageJsonPath = join(root, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = readPackageJson(packageJsonPath);
    const deps = collectDependencyNames(packageJson);

    for (const [dependencyName, kind] of [
      ["next", "next"],
      ["vite", "vite"],
      ["react", "react"],
      ["vue", "vue"],
    ] as const) {
      if (deps.has(dependencyName)) {
        evidence.push(`package.json dependency: ${dependencyName}`);
        return { kind, evidence };
      }
    }

    evidence.push("package.json");
  }

  if (existsSync(join(root, "Cargo.toml"))) {
    return {
      kind: "rust",
      evidence: ["Cargo.toml"],
    };
  }

  if (existsSync(join(root, "pyproject.toml"))) {
    return {
      kind: "python",
      evidence: ["pyproject.toml"],
    };
  }

  return {
    kind: "unknown",
    evidence,
  };
}

function readPackageJson(packageJsonPath: string): PackageJson {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  } catch {
    return {};
  }
}

function collectDependencyNames(packageJson: PackageJson): Set<string> {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);
}
