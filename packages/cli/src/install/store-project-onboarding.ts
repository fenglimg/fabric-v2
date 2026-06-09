import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { loadProjectConfig, saveProjectConfig } from "../store/project-config-io.js";
import {
  storeBind,
  storeProjectCreate,
  storeProjectList,
  storeSetWriteRoute,
  storeSwitchWrite,
} from "../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../store/bindings-io.js";

export interface StoreProjectBindingResult {
  project_id: string;
  active_project: string;
  project_created: boolean;
}

export interface EnsureStoreProjectBindingOptions {
  globalRoot: string;
  now?: string;
  requestedProjectId?: string;
  suggestedRemote?: string;
  uuid?: string;
}

export function ensureProjectId(projectRoot: string, uuid: string = randomUUID()): string {
  const config = loadProjectConfig(projectRoot) ?? {};
  if (typeof config.project_id === "string" && config.project_id.length > 0) {
    return config.project_id;
  }
  saveProjectConfig({ ...config, project_id: uuid }, projectRoot);
  return uuid;
}

export function suggestStoreProjectId(projectRoot: string): string {
  return normalizeStoreProjectId(readGitRemoteName(projectRoot) ?? basename(projectRoot));
}

export function normalizeStoreProjectId(value: string): string {
  const normalized = value
    .trim()
    .replace(/\.git$/iu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "");
  return normalized.length > 0 ? normalized : "project";
}

export async function ensureStoreProjectBinding(
  projectRoot: string,
  storeAlias: string,
  options: EnsureStoreProjectBindingOptions,
): Promise<StoreProjectBindingResult> {
  const now = options.now ?? new Date().toISOString();
  const project_id = ensureProjectId(projectRoot, options.uuid);
  const currentConfig = loadProjectConfig(projectRoot);
  const requested =
    options.requestedProjectId ??
    currentConfig?.active_project ??
    suggestStoreProjectId(projectRoot);
  const active_project = normalizeStoreProjectId(requested);

  const projects = await storeProjectList(storeAlias, options.globalRoot);
  const project_created = !projects.some((project) => project.id === active_project);
  if (project_created) {
    await storeProjectCreate(storeAlias, active_project, now, {
      name: active_project,
      globalRoot: options.globalRoot,
    });
  }

  const entry =
    options.suggestedRemote === undefined
      ? { id: storeAlias }
      : { id: storeAlias, suggested_remote: options.suggestedRemote };
  await storeBind(projectRoot, entry, { project: active_project, globalRoot: options.globalRoot });
  storeSwitchWrite(projectRoot, storeAlias, { globalRoot: options.globalRoot });
  storeSetWriteRoute(projectRoot, `project:${active_project}`, storeAlias, {
    globalRoot: options.globalRoot,
  });
  regenerateBindingsSnapshot(projectRoot, {
    now,
    globalRoot: options.globalRoot,
  });

  return { project_id, active_project, project_created };
}

function readGitRemoteName(projectRoot: string): string | null {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (remote.length === 0) {
      return null;
    }
    const lastSegment = remote.split(/[/:\\]/u).filter(Boolean).at(-1);
    return lastSegment === undefined ? null : lastSegment.replace(/\.git$/iu, "");
  } catch {
    return null;
  }
}
