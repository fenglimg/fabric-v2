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
  framework: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  ast_evidence: string[];
  co_packages: string[];
};

export type TechProfile = FrameworkInfo;

type PackageJson = {
  creator?: {
    version?: string;
  };
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
      framework: "cocos-creator",
      confidence: "HIGH",
      ast_evidence: [],
      co_packages: collectProjectFileEvidence(root, ["package.json", "tsconfig.json"]),
    };
  }

  const packageJsonPath = join(root, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = readPackageJson(packageJsonPath);
    const creatorVersion = packageJson.creator?.version;

    if (typeof creatorVersion === "string" && creatorVersion.trim().length > 0) {
      const deps = collectDependencyVersions(packageJson);
      return {
        kind: "cocos-creator",
        version: creatorVersion,
        subkind: inferCocosSubkind(root, creatorVersion),
        evidence: [`package.json: creator.version=${creatorVersion}`],
        framework: "cocos-creator",
        confidence: "HIGH",
        ast_evidence: [],
        co_packages: collectCoPackages(deps, "cocos-creator", root),
      };
    }

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
          framework: kind,
          confidence: determinePackageConfidence(kind, deps, root),
          ast_evidence: [],
          co_packages: collectCoPackages(deps, kind, root),
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
      framework: "rust",
      confidence: "HIGH",
      ast_evidence: [],
      co_packages: collectProjectFileEvidence(root, ["Cargo.lock"]),
    };
  }

  if (existsSync(join(root, "pyproject.toml"))) {
    return {
      kind: "python",
      version: "unknown",
      subkind: "pyproject",
      evidence: ["pyproject.toml"],
      framework: "python",
      confidence: "HIGH",
      ast_evidence: [],
      co_packages: collectProjectFileEvidence(root, ["uv.lock", "poetry.lock", "requirements.txt"]),
    };
  }

  return {
    kind: "unknown",
    version: "unknown",
    subkind: "unknown",
    evidence,
    framework: "unknown",
    confidence: "LOW",
    ast_evidence: [],
    co_packages: [],
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

function determinePackageConfidence(
  kind: FrameworkInfo["kind"],
  deps: Map<string, string>,
  root: string,
): FrameworkInfo["confidence"] {
  const coPackages = collectCoPackages(deps, kind, root);
  return coPackages.length > 0 ? "HIGH" : "MEDIUM";
}

function collectCoPackages(deps: Map<string, string>, kind: FrameworkInfo["kind"], root: string): string[] {
  const expectedPackagesByFramework: Partial<Record<FrameworkInfo["kind"], string[]>> = {
    next: ["react", "react-dom", "typescript"],
    vite: ["@vitejs/plugin-react", "@vitejs/plugin-vue", "typescript", "react", "vue"],
    react: ["react-dom", "@types/react", "@types/react-dom"],
    vue: ["@vitejs/plugin-vue", "typescript"],
    "cocos-creator": ["typescript"],
  };
  const expectedProjectFilesByFramework: Partial<Record<FrameworkInfo["kind"], string[]>> = {
    next: ["next.config.js", "next.config.mjs", "next.config.ts", "tsconfig.json"],
    vite: ["vite.config.js", "vite.config.mjs", "vite.config.ts", "tsconfig.json"],
    react: ["tsconfig.json"],
    vue: ["vue.config.js", "vite.config.ts", "tsconfig.json"],
    "cocos-creator": ["project.config.json", "tsconfig.json"],
  };

  return [
    ...compactStrings((expectedPackagesByFramework[kind] ?? []).map((packageName) => (deps.has(packageName) ? packageName : null))),
    ...collectProjectFileEvidence(root, expectedProjectFilesByFramework[kind] ?? []),
  ];
}

function collectProjectFileEvidence(root: string, relativePaths: string[]): string[] {
  return relativePaths.filter((relativePath) => existsSync(join(root, relativePath)));
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null && value !== undefined && value.length > 0))];
}
