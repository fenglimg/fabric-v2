import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import type { InstallStepResult } from "./step-result.js";

/**
 * Reading a shipped template, and writing one copy of it into a project.
 *
 * The two primitives every install writer is built from. `copyTextIdempotent`
 * is where the idempotency contract actually lives: re-running `fabric install`
 * against an unchanged tree produces no write, which is what lets the pipeline
 * report an honest "0 installed" on a clean re-run.
 */

export async function readTemplate(relativePath: string): Promise<string> {
  const path = findTemplatePath(relativePath);
  return readFile(path, "utf8");
}

export async function readJsonTemplate(relativePath: string): Promise<Record<string, unknown>> {
  const raw = await readTemplate(relativePath);
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Template at ${relativePath} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve a `templates/...` path that ships inside the @fenglimg/fabric-cli
 * package. Walks up from the current module's directory looking for a
 * `templates/<relativePath>` sibling — which works in both:
 *   - dev/test (this file at packages/cli/src/install/template-io.ts;
 *     templates at packages/cli/templates/...)
 *   - bundled (this file packed into packages/cli/dist/<chunk>.js;
 *     templates at packages/cli/templates/...)
 */
export function findTemplatePath(relativePath: string): string {
  const startDir = dirname(fileURLToPath(import.meta.url));
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, "templates", relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      throw new Error(`Template not found: templates/${relativePath} (searched up from ${startDir})`);
    }
    current = parent;
  }
}

export async function copyTextIdempotent(
  step: string,
  source: string,
  target: string,
): Promise<InstallStepResult> {
  if (existsSync(target)) {
    try {
      const existing = readFileSync(target, "utf8");
      if (existing === source) {
        return { step, path: target, status: "skipped", message: "up-to-date" };
      }
    } catch {
      // unreadable target — fall through to overwrite
    }
  }
  await mkdir(dirname(target), { recursive: true });
  await atomicWriteText(target, source);
  return { step, path: target, status: "written" };
}
