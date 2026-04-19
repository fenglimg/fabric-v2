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
  version: string;
  subkind: string;
  evidence: string[];
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type CreatorConfig = {
  creator?: {
    version?: string;
  };
};

export function detectFramework(root: string): FrameworkInfo {
  const evidence: string[] = [];

  const creatorConfigPath = join(root, "project.config.json");
  if (existsSync(creatorConfigPath)) {
    const version = readCreatorVersion(creatorConfigPath);
    return {
      kind: "cocos-creator",
      version,
      subkind: inferCocosSubkind(root, version),
      evidence:
        version === "unknown"
          ? ["project.config.json"]
          : [`project.config.json: creator.version=${version}`],
    };
  }

  const packageJsonPath = join(root, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = readPackageJson(packageJsonPath);
    const deps = collectDependencyVersions(packageJson);

    for (const [dependencyName, kind] of [
      ["next", "next"],
      ["vite", "vite"],
      ["react", "react"],
      ["vue", "vue"],
    ] as const) {
      if (deps.has(dependencyName)) {
        const version = deps.get(dependencyName) ?? "unknown";
        evidence.push(`package.json dependency: ${dependencyName}@${version}`);
        return {
          kind,
          version,
          subkind: inferPackageSubkind(kind),
          evidence,
        };
      }
    }

    evidence.push("package.json");
  }

  if (existsSync(join(root, "Cargo.toml"))) {
    return {
      kind: "rust",
      version: "unknown",
      subkind: "cargo-project",
      evidence: ["Cargo.toml"],
    };
  }

  if (existsSync(join(root, "pyproject.toml"))) {
    return {
      kind: "python",
      version: "unknown",
      subkind: "pyproject",
      evidence: ["pyproject.toml"],
    };
  }

  return {
    kind: "unknown",
    version: "unknown",
    subkind: "unknown",
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

function readCreatorVersion(creatorConfigPath: string): string {
  try {
    const creatorConfig = JSON.parse(readFileSync(creatorConfigPath, "utf8")) as CreatorConfig;
    return creatorConfig.creator?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function collectDependencyVersions(packageJson: PackageJson): Map<string, string> {
  return new Map([
    ...Object.entries(packageJson.dependencies ?? {}),
    ...Object.entries(packageJson.devDependencies ?? {}),
    ...Object.entries(packageJson.peerDependencies ?? {}),
    ...Object.entries(packageJson.optionalDependencies ?? {}),
  ]);
}

function inferCocosSubkind(root: string, version: string): string {
  const majorVersion = Number.parseInt(version.split(".")[0] ?? "", 10);

  if (majorVersion === 2) {
    return "javascript-traditional";
  }

  if (majorVersion >= 3) {
    return "typescript-component";
  }

  return existsSync(join(root, "tsconfig.json")) ? "typescript-component" : "javascript-traditional";
}

function inferPackageSubkind(kind: FrameworkInfo["kind"]): string {
  switch (kind) {
    case "next":
      return "next-application";
    case "vite":
      return "vite-application";
    case "react":
      return "react-application";
    case "vue":
      return "vue-application";
    default:
      return "unknown";
  }
}
