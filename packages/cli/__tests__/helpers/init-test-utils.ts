import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEREWOLF_FIXTURE = fileURLToPath(new URL("../fixtures/cocos-stub", import.meta.url));

export function createWerewolfFixtureRoot(prefix: string): string {
  const root = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  cpSync(WEREWOLF_FIXTURE, root, { recursive: true });
  if (existsSync(join(root, "AGENTS.md"))) {
    rmSync(join(root, "AGENTS.md"));
  }
  rmSync(join(root, ".fabric"), { recursive: true, force: true });
  rmSync(join(root, ".claude"), { recursive: true, force: true });
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

export function createEmptyFixtureRoot(prefix: string): string {
  const root = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), '{\n  "name": "fixture"\n}\n', "utf8");
  return root;
}

export function setProcessTty(
  stdoutValue: boolean,
  stderrValue: boolean = stdoutValue,
  stdinValue: boolean = stdoutValue,
): () => void {
  const descriptors = [
    [process.stdin, Object.getOwnPropertyDescriptor(process.stdin, "isTTY"), stdinValue] as const,
    [process.stdout, Object.getOwnPropertyDescriptor(process.stdout, "isTTY"), stdoutValue] as const,
    [process.stderr, Object.getOwnPropertyDescriptor(process.stderr, "isTTY"), stderrValue] as const,
  ];

  for (const [stream, , value] of descriptors) {
    Object.defineProperty(stream, "isTTY", {
      configurable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const [stream, descriptor] of descriptors) {
      if (descriptor === undefined) {
        delete (stream as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
        continue;
      }

      Object.defineProperty(stream, "isTTY", descriptor);
    }
  };
}
