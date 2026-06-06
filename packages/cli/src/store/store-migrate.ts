import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  STORE_PENDING_DIR,
  buildStoreResolveInput,
  createStoreResolver,
  formatKnowledgeId,
  parseKnowledgeId,
  reconcileStoreCounters,
  resolveGlobalRoot,
  storeRelativePath,
  type KnowledgeType,
} from "@fenglimg/fabric-shared";

import { loadGlobalConfig } from "./global-config-io.js";

// ---------------------------------------------------------------------------
// v2.2 全砍 Stage 1 (B2 cutover) — `fabric store migrate`.
//
// Before the dual-root fallback is removed (Stage 2), the project-local
// knowledge that still lives under <repo>/.fabric/knowledge (team layer) and the
// old ~/.fabric/knowledge personal root must be relocated INTO the resolved
// write-target stores, or it would be orphaned the moment the write path goes
// store-only. This is the safety net: a true MOVE (copy into store → git commit
// in the store repo → remove from source) with stable_id collision remapping and
// a dry-run preview.
//
// stable_id per-store namespace (northstar): a store has its own id space, so an
// incoming KT-DEC-0001 collides with the store's existing KT-DEC-0001. On
// collision we re-allocate the next free counter in the target store for that
// (layer, type) and rewrite the `id:` frontmatter + filename, recording the
// remap so any `related:` cross-references are rewritten too. No collision → the
// id is preserved byte-for-byte (the common case for a fresh store).
// ---------------------------------------------------------------------------

type SourceLayer = "team" | "personal";

export interface MigrateItem {
  source: string; // absolute source file path
  layer: SourceLayer;
  type: string; // canonical type dir name, or "pending"
  oldId: string | null;
  newId: string | null; // set only when remapped on collision
  target: string; // absolute target file path inside the store
  storeUuid: string;
  alias: string;
}

export interface MigrateSkip {
  source: string;
  reason: string;
}

export interface MigrateTargetInfo {
  uuid: string;
  dir: string;
}

export interface MigrateReport {
  dryRun: boolean;
  committed: boolean;
  items: MigrateItem[];
  skips: MigrateSkip[];
  remap: Record<string, string>;
  targets: Partial<Record<SourceLayer, MigrateTargetInfo>>;
}

export interface MigrateOptions {
  dryRun?: boolean;
  globalRoot?: string;
  git?: boolean; // run git add+commit in the store repo (default true)
}

interface ResolvedTarget {
  uuid: string;
  alias: string;
  dir: string; // <globalRoot>/stores/<uuid>
}

// Resolve the write-target store directory for a layer via the SAME resolver the
// CLI scope-explain / server write path use. null when no store is selected
// (team layer with no active_write_store, or personal layer with no personal
// store mounted).
function resolveTargetStore(
  layer: SourceLayer,
  projectRoot: string,
  globalRoot: string,
): ResolvedTarget | null {
  const input = buildStoreResolveInput(projectRoot, globalRoot);
  if (input === null) {
    return null;
  }
  const scope = layer === "personal" ? "personal" : "team";
  const { target } = createStoreResolver().resolveWriteTarget(input, scope);
  if (target === null) {
    return null;
  }
  const alias =
    loadGlobalConfig(globalRoot)?.stores.find((s) => s.store_uuid === target.store_uuid)?.alias ??
    target.store_uuid;
  return {
    uuid: target.store_uuid,
    alias,
    dir: join(globalRoot, storeRelativePath(target.store_uuid)),
  };
}

function listMd(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

function readId(content: string): string | null {
  const match = content.match(/^id:\s*(\S+)\s*$/mu);
  return match ? match[1] : null;
}

// slug suffix of a knowledge filename (the part after `<id>--`), "" when none.
function slugSuffix(fileName: string, oldId: string | null): string {
  const stem = fileName.replace(/\.md$/u, "");
  if (oldId !== null && stem.startsWith(`${oldId}--`)) {
    return stem.slice(oldId.length); // includes leading "--"
  }
  return "";
}

// Per-target-store, per-(layer,type) collision index: existing ids + the highest
// counter seen, so remapped ids continue the store's own monotonic sequence.
interface StoreIdIndex {
  existing: Set<string>;
  maxCounter: Map<string, number>; // key: `${layerPrefix}-${typeCode}`
}

function buildStoreIdIndex(storeDir: string): StoreIdIndex {
  const existing = new Set<string>();
  const maxCounter = new Map<string, number>();
  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const dir = join(storeDir, STORE_LAYOUT.knowledgeDir, type);
    for (const file of listMd(dir)) {
      const content = readFileSync(join(dir, file), "utf8");
      const id = readId(content) ?? file.replace(/\.md$/u, "").split("--")[0];
      const parsed = parseKnowledgeId(id);
      if (parsed === null) {
        continue;
      }
      existing.add(id);
      const key = id.slice(0, id.lastIndexOf("-"));
      maxCounter.set(key, Math.max(maxCounter.get(key) ?? 0, parsed.counter));
    }
  }
  return { existing, maxCounter };
}

function nextId(
  index: StoreIdIndex,
  layer: "team" | "personal",
  type: KnowledgeType,
): string {
  // Derive the `<prefix>-<typeCode>` key the same way ids print (KT-DEC etc.).
  const probe = formatKnowledgeId(layer, type, 1);
  const key = probe.slice(0, probe.lastIndexOf("-"));
  let counter = (index.maxCounter.get(key) ?? 0) + 1;
  let id = formatKnowledgeId(layer, type, counter);
  while (index.existing.has(id)) {
    counter += 1;
    id = formatKnowledgeId(layer, type, counter);
  }
  index.existing.add(id);
  index.maxCounter.set(key, counter);
  return id;
}

function typeDirToKnowledgeType(typeDir: string): KnowledgeType | null {
  return (STORE_KNOWLEDGE_TYPE_DIRS as readonly string[]).includes(typeDir)
    ? (typeDir as KnowledgeType)
    : null;
}

// Core: plan the move from project-local dual-root knowledge into the resolved
// write-target stores. When dryRun is false, performs the move + git commit.
export function migrateProjectKnowledge(
  projectRoot: string,
  options: MigrateOptions = {},
): MigrateReport {
  const dryRun = options.dryRun ?? false;
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  const runGit = options.git ?? true;

  const items: MigrateItem[] = [];
  const skips: MigrateSkip[] = [];
  const remap: Record<string, string> = {};
  const targets: Partial<Record<SourceLayer, MigrateTargetInfo>> = {};

  // Source roots for the two dual-root layers being retired.
  const sourceRoots: Record<SourceLayer, string> = {
    team: join(projectRoot, ".fabric", "knowledge"),
    personal: join(globalRoot, "knowledge"),
  };

  // Resolve + index the target store once per layer.
  const layerState: Partial<
    Record<SourceLayer, { target: ResolvedTarget; index: StoreIdIndex }>
  > = {};
  for (const layer of ["team", "personal"] as const) {
    if (!existsSync(sourceRoots[layer])) {
      continue;
    }
    const target = resolveTargetStore(layer, projectRoot, globalRoot);
    if (target === null) {
      continue; // recorded per-entry below so the skip count is accurate
    }
    targets[layer] = { uuid: target.uuid, dir: target.dir };
    layerState[layer] = { target, index: buildStoreIdIndex(target.dir) };
  }

  for (const layer of ["team", "personal"] as const) {
    const root = sourceRoots[layer];
    if (!existsSync(root)) {
      continue;
    }
    const state = layerState[layer];

    // Canonical typed entries.
    for (const typeDir of STORE_KNOWLEDGE_TYPE_DIRS) {
      const dir = join(root, typeDir);
      for (const file of listMd(dir)) {
        const source = join(dir, file);
        if (state === undefined) {
          skips.push({
            source,
            reason: `no ${layer} write-target store — run \`fabric install --global\` then \`fabric store bind <alias>\`${layer === "team" ? " + `fabric store switch-write <alias>`" : ""}`,
          });
          continue;
        }
        const content = readFileSync(source, "utf8");
        const oldId = readId(content);
        const knowledgeType = typeDirToKnowledgeType(typeDir);
        let newId: string | null = null;
        if (oldId !== null && state.index.existing.has(oldId) && knowledgeType !== null) {
          const parsed = parseKnowledgeId(oldId);
          const idLayer = parsed?.layer ?? (layer as "team" | "personal");
          newId = nextId(state.index, idLayer, knowledgeType);
          remap[oldId] = newId;
        } else if (oldId !== null) {
          state.index.existing.add(oldId);
          const parsed = parseKnowledgeId(oldId);
          if (parsed !== null) {
            const key = oldId.slice(0, oldId.lastIndexOf("-"));
            state.index.maxCounter.set(
              key,
              Math.max(state.index.maxCounter.get(key) ?? 0, parsed.counter),
            );
          }
        }
        const effectiveId = newId ?? oldId;
        const targetName =
          newId !== null && effectiveId !== null
            ? `${effectiveId}${slugSuffix(file, oldId)}.md`
            : file;
        const targetFile = join(state.target.dir, STORE_LAYOUT.knowledgeDir, typeDir, targetName);
        items.push({
          source,
          layer,
          type: typeDir,
          oldId,
          newId,
          target: targetFile,
          storeUuid: state.target.uuid,
          alias: state.target.alias,
        });
      }
    }

    // Pending drafts (no stable_id yet — allocated at approve time). Copy as-is;
    // skip on a filename collision rather than risk clobbering a store draft.
    const pendingRoot = join(root, STORE_PENDING_DIR);
    for (const sub of [".", "decisions", "guidelines", "pitfalls", "models", "processes"]) {
      const dir = sub === "." ? pendingRoot : join(pendingRoot, sub);
      for (const file of listMd(dir)) {
        const source = join(dir, file);
        if (state === undefined) {
          skips.push({ source, reason: `no ${layer} write-target store` });
          continue;
        }
        const rel = sub === "." ? file : join(sub, file);
        const targetFile = join(
          state.target.dir,
          STORE_LAYOUT.knowledgeDir,
          STORE_PENDING_DIR,
          rel,
        );
        if (existsSync(targetFile)) {
          skips.push({ source, reason: `pending already present in store: ${basename(targetFile)}` });
          continue;
        }
        items.push({
          source,
          layer,
          type: STORE_PENDING_DIR,
          oldId: null,
          newId: null,
          target: targetFile,
          storeUuid: state.target.uuid,
          alias: state.target.alias,
        });
      }
    }
  }

  if (dryRun || items.length === 0) {
    return { dryRun, committed: false, items, skips, remap, targets };
  }

  // Apply: write into stores (rewriting id + related), then remove sources.
  for (const item of items) {
    let content = readFileSync(item.source, "utf8");
    if (item.newId !== null && item.oldId !== null) {
      content = content.replace(/^id:\s*\S+\s*$/mu, `id: ${item.newId}`);
    }
    content = rewriteRelated(content, remap);
    mkdirSync(join(item.target, ".."), { recursive: true });
    writeFileSync(item.target, content, "utf8");
  }
  // Remove sources only after every write succeeded (move semantics).
  for (const item of items) {
    rmSync(item.source, { force: true });
  }

  // W4 F1 (producer↔consumer): seed each target store's counters.json to the
  // floor of the ids just imported, so the runtime allocator
  // (allocateStoreKnowledgeId) mints the NEXT free id instead of re-minting an
  // imported one. Done before the git commit so counters.json is committed with
  // the moved entries.
  for (const info of Object.values(targets)) {
    if (items.some((i) => i.storeUuid === info.uuid)) {
      reconcileStoreCounters(info.dir);
    }
  }

  let committed = false;
  if (runGit) {
    for (const [layer, info] of Object.entries(targets)) {
      const moved = items.filter((i) => i.layer === layer).length;
      if (moved === 0) {
        continue;
      }
      committed = gitCommitStore(info.dir, moved) || committed;
    }
  }

  return { dryRun, committed, items, skips, remap, targets };
}

// Rewrite remapped ids inside the frontmatter `related:` flow array (the only
// place one entry references another's stable_id). No-op when remap is empty or
// the entry has no related edges.
function rewriteRelated(content: string, remap: Record<string, string>): string {
  if (Object.keys(remap).length === 0) {
    return content;
  }
  return content.replace(/^related:\s*\[(.*)\]\s*$/mu, (line, inner: string) => {
    const rewritten = inner
      .split(",")
      .map((token) => {
        const trimmed = token.trim();
        return remap[trimmed] ?? trimmed;
      })
      .join(", ");
    return `related: [${rewritten}]`;
  });
}

function gitCommitStore(storeDir: string, count: number): boolean {
  if (!existsSync(join(storeDir, ".git"))) {
    return false;
  }
  try {
    execFileSync("git", ["add", "-A"], { cwd: storeDir, stdio: ["ignore", "ignore", "pipe"] });
    execFileSync(
      "git",
      ["commit", "-m", `chore(migrate): import ${count} entries from project dual-root`],
      { cwd: storeDir, stdio: ["ignore", "ignore", "pipe"] },
    );
    return true;
  } catch {
    // Nothing to commit, or git failure — the files are already in the store
    // working tree; the next `fabric sync` surfaces any real git issue.
    return false;
  }
}
