import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import type { ClientKind, ServerEntry } from "./writer.js";

export type RootPinState = "managed" | "explicit" | "ambiguous" | "absent";

export type RootPinInput = {
  configPath?: string;
  clientKind: ClientKind | string;
  command?: string;
  args?: string[];
  root?: string;
  entry?: ServerEntry | null;
  raw?: string;
};

export type RootPinInspection = {
  state: RootPinState;
  reason: string;
  digest?: string;
  root?: string;
  marker?: string;
  format?: "json" | "toml";
  configPath?: string;
};

export type RootPinRepairResult = RootPinInspection & {
  changed: boolean;
  backupPath?: string;
  backupSha256?: string;
  restored?: boolean;
};

function digestFor(input: Required<Pick<RootPinInput, "clientKind" | "command" | "args" | "root">>): string {
  // Digest contract: createHash('sha256') over the versioned entry tuple.
  return createHash("sha256")
    .update(`v1\0${input.clientKind}\0${input.command}\0${JSON.stringify(input.args)}\0${resolve(input.root)}`)
    .digest("hex");
}

function entryValues(input: RootPinInput): { command?: string; args?: string[]; root?: string; marker?: string } {
  const entry = input.entry;
  const env = entry?.env;
  return {
    command: input.command ?? entry?.command,
    args: input.args ?? entry?.args,
    root: input.root ?? (typeof env?.FABRIC_PROJECT_ROOT === "string" ? env.FABRIC_PROJECT_ROOT : undefined),
    marker: typeof env?.FABRIC_PROJECT_ROOT_PROVENANCE === "string" ? env.FABRIC_PROJECT_ROOT_PROVENANCE : undefined,
  };
}

function parseToml(raw: string): { entry: ServerEntry | null; marker?: string; root?: string } {
  const match = raw.match(/(?:^|\n)\[mcp_servers\.fabric\]\n([\s\S]*?)(?=\n\[[^\n]+\]|$)/);
  if (!match) return { entry: null };
  const body = match[1];
  const command = body.match(/^command\s*=\s*"((?:\\.|[^"\\])*)"/m)?.[1];
  const argsRaw = body.match(/^args\s*=\s*\[([^\]]*)\]/m)?.[1];
  const args = argsRaw === undefined ? undefined : Array.from(argsRaw.matchAll(/"((?:\\.|[^"\\])*)"/g), (m) => JSON.parse(`"${m[1]}"`));
  const envRaw = body.match(/^env\s*=\s*\{([^}]*)\}/m)?.[1] ?? "";
  const root = envRaw.match(/FABRIC_PROJECT_ROOT\s*=\s*"((?:\\.|[^"\\])*)"/)?.[1];
  const marker = envRaw.match(/FABRIC_PROJECT_ROOT_PROVENANCE\s*=\s*"((?:\\.|[^"\\])*)"/)?.[1];
  return { entry: command === undefined || args === undefined ? null : { command: JSON.parse(`"${command}"`), args, env: {} }, root: root && JSON.parse(`"${root}"`), marker: marker && JSON.parse(`"${marker}"`) };
}

function extract(input: RootPinInput): RootPinInput {
  if (input.entry || input.command || input.root || input.raw === undefined) return input;
  if (input.raw.trimStart().startsWith("{")) {
    const parsed = JSON.parse(input.raw) as { mcpServers?: Record<string, ServerEntry> };
    return { ...input, entry: parsed.mcpServers?.fabric ?? null };
  }
  const parsed = parseToml(input.raw);
  const entry = parsed.entry ? { ...parsed.entry, env: { ...(parsed.entry.env ?? {}), ...(parsed.root ? { FABRIC_PROJECT_ROOT: parsed.root } : {}), ...(parsed.marker ? { FABRIC_PROJECT_ROOT_PROVENANCE: parsed.marker } : {}) } } : null;
  return { ...input, entry };
}

export function inspectManagedRootPin(source: RootPinInput): RootPinInspection {
  const input = extract(source);
  const values = entryValues(input);
  const format = input.raw?.trimStart().startsWith("{") ? "json" : input.raw === undefined ? undefined : "toml";
  if (values.root === undefined && values.marker === undefined) return { state: "absent", reason: "root-and-marker-absent", format, configPath: input.configPath };
  if (values.marker === "operator:v1" || values.marker === "project:v1") return { state: "explicit", reason: "explicit-marker", root: values.root, marker: values.marker, format, configPath: input.configPath };
  if (values.root === undefined || values.marker === undefined) return { state: "ambiguous", reason: "missing-or-marker-only", root: values.root, marker: values.marker, format, configPath: input.configPath };
  if (values.command === undefined || values.args === undefined) return { state: "ambiguous", reason: "incomplete-entry", root: values.root, marker: values.marker, format, configPath: input.configPath };
  const digest = digestFor({ clientKind: input.clientKind, command: values.command, args: values.args, root: values.root });
  const expected = `fabric-installer:v1:${digest}`;
  return values.marker === expected
    ? { state: "managed", reason: "installer-marker-matches-entry", digest, root: values.root, marker: values.marker, format, configPath: input.configPath }
    : { state: "ambiguous", reason: "installer-marker-mismatch", digest, root: values.root, marker: values.marker, format, configPath: input.configPath };
}

function removeJson(raw: string): string {
  const parsed = JSON.parse(raw) as { mcpServers?: Record<string, ServerEntry> };
  const entry = parsed.mcpServers?.fabric;
  if (entry?.env) {
    delete entry.env.FABRIC_PROJECT_ROOT;
    delete entry.env.FABRIC_PROJECT_ROOT_PROVENANCE;
    if (Object.keys(entry.env).length === 0) delete entry.env;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function removeToml(raw: string): string {
  const block = /(^|\n)(\[mcp_servers\.fabric\]\n)([\s\S]*?)(?=\n\[[^\n]+\]|$)/;
  return raw.replace(block, (_all, prefix: string, header: string, body: string) => {
    const nextBody = body.replace(/(^|\n)env\s*=\s*\{([^}\n]*)\}/m, (_envAll, envPrefix: string, envBody: string) => {
      const kept = envBody
        .split(",")
        .map((x: string) => x.trim())
        .filter((x: string) => !/^FABRIC_PROJECT_ROOT(?:_PROVENANCE)?\s*=/.test(x));
      return kept.length ? `${envPrefix}env = { ${kept.join(", ")} }` : "";
    });
    return `${prefix}${header}${nextBody}`;
  });
}

function compactTimestamp(): string { return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14); }

export async function repairManagedRootPin(source: RootPinInput & { configPath: string; injectFailureAfterBackup?: boolean }): Promise<RootPinRepairResult> {
  const raw = source.raw ?? await readFile(source.configPath, "utf8");
  const inspection = inspectManagedRootPin({ ...source, raw });
  if (inspection.state !== "managed") return { ...inspection, changed: false };
  const backupPath = `${source.configPath}.fabric-backup.${compactTimestamp()}`;
  const originalHash = createHash("sha256").update(raw).digest("hex");
  await mkdir(dirname(source.configPath), { recursive: true });
  const handle = await open(backupPath, "wx", 0o600);
  try { await handle.writeFile(raw, "utf8"); await handle.datasync(); } finally { await handle.close(); }
  const verifiedBackup = await readFile(backupPath, "utf8");
  if (verifiedBackup !== raw || createHash("sha256").update(verifiedBackup).digest("hex") !== originalHash) throw new Error("backup verification failed");
  try {
    if (source.injectFailureAfterBackup) throw new Error("injected post-backup failure");
    const next = inspection.format === "toml" ? removeToml(raw) : removeJson(raw);
    if (inspection.format === "toml") await atomicWriteText(source.configPath, next);
    else await atomicWriteJson(source.configPath, JSON.parse(next), { indent: 2 });
    return { ...inspection, changed: true, backupPath, backupSha256: originalHash };
  } catch (error) {
    await atomicWriteText(source.configPath, raw);
    const restored = (await readFile(source.configPath, "utf8")) === raw;
    if (!restored) throw new Error("restore verification failed", { cause: error });
    throw error;
  }
}

export { digestFor };
