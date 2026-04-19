import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const WEREWOLF_FIXTURE = resolve(process.cwd(), "../../examples/werewolf-minigame-stub");

export function createWerewolfFixtureRoot(prefix: string): string {
  const root = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  cpSync(WEREWOLF_FIXTURE, root, { recursive: true });
  return root;
}

export function cleanupFixtureRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export function writeFixtureFile(root: string, relativePath: string, content: string): string {
  const targetPath = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
  return targetPath;
}

export function readFixtureFile(root: string, relativePath: string): string {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}
