import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface CliPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as CliPackageJson;

describe("CLI manifest compatibility", () => {
  it("keeps Ink 4 on the React 18 line", () => {
    expect(packageJson.dependencies?.ink).toBe("^4.4.1");
    expect(packageJson.dependencies?.react).toBe("^18.3.1");
    expect(packageJson.devDependencies?.["@types/react"]).toBe("^18.3.12");
  });

  it("does not depend on @inkjs/ui until the CLI upgrades to Ink 5", () => {
    expect(packageJson.dependencies).not.toHaveProperty("@inkjs/ui");
  });
});
