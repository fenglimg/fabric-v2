/**
 * rc.35 TASK-06 (P0-10.b) — summary-fallback library.
 *
 * Resolves opaque hint entries (where `entry.summary === entry.id` so the
 * AI sees no information beyond the id) by reading the entry's markdown file
 * from mounted store `knowledge/<type>/<id>--<slug>.md`, extracting the first
 * paragraph under `## Summary`, and substituting that text into the entry
 * before the hook renders it.
 *
 * Caching: results are stored in `.fabric/.cache/summary-fallback.json`
 * keyed by the current `revision_hash` returned by plan-context-hint. The
 * cache is wiped wholesale when the revision changes (cheap invariant —
 * any meta rev bump implies entry text MAY have moved). Per-process call
 * also benefits from in-memory dedup since the same opaque id may appear
 * across narrow + broad paths.
 *
 * Design contract:
 *   - Never throw. ANY failure (cache read, fs scan, file read) degrades
 *     to a no-op — the original opaque summary is left untouched. Hooks
 *     must remain best-effort.
 *   - Idempotent over identical inputs. Two calls in succession with the
 *     same revision_hash + entries set produce zero disk reads on the
 *     second call.
 *
 * Public API (module.exports):
 *   resolveOpaqueSummaries(entries, projectRoot, revisionHash) — returns
 *     a NEW array of entries with `summary` substituted for opaque cases.
 *     Original `entry.id` is preserved verbatim.
 *
 *   _extractFirstSummaryParagraph(md) — pure helper, exposed for testing.
 *
 *   _readCache / _writeCache — exposed for testing.
 */

const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

const CACHE_DIR_REL = ".fabric/.cache";
const CACHE_FILE_REL = ".fabric/.cache/summary-fallback.json";
const GLOBAL_CONFIG_FILE = "fabric-global.json";
const PROJECT_CONFIG_REL = ".fabric/fabric-config.json";
const SUMMARY_MAX_LEN = 80;
const KNOWLEDGE_TYPE_DIRS = ["decisions", "pitfalls", "guidelines", "models", "processes"];

function _isOpaque(entry) {
  if (!entry || typeof entry.id !== "string" || typeof entry.summary !== "string") {
    return false;
  }
  return entry.summary.trim() === entry.id.trim();
}

/**
 * Pure helper: extract the first paragraph under a `## Summary` heading.
 *
 *   - `## Summary` is case-insensitive but level-sensitive (only H2).
 *   - First paragraph = lines until blank line or next heading.
 *   - Collapses whitespace + trims; returns `""` if no summary section or
 *     the section is empty.
 */
function _extractFirstSummaryParagraph(md) {
  if (typeof md !== "string" || md.length === 0) return "";
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    if (/^##\s+summary\s*$/i.test(lines[i].trim())) {
      i += 1;
      break;
    }
    i += 1;
  }
  if (i >= lines.length) return "";
  // Skip blank lines after the heading
  while (i < lines.length && lines[i].trim().length === 0) i += 1;
  // Collect until the next blank line or next heading
  const buf = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().length === 0) break;
    if (/^#{1,6}\s/.test(line.trim())) break;
    buf.push(line.trim());
    i += 1;
  }
  const flat = buf.join(" ").replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  if (flat.length <= SUMMARY_MAX_LEN) return flat;
  return `${flat.slice(0, SUMMARY_MAX_LEN - 1)}…`;
}

function _readCache(projectRoot) {
  const cachePath = join(projectRoot, CACHE_FILE_REL);
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.revision === "string" && parsed.summaries && typeof parsed.summaries === "object") {
      return parsed;
    }
  } catch {
    // ignore — caller treats null as no-cache
  }
  return null;
}

function _writeCache(projectRoot, payload) {
  try {
    const cacheDir = join(projectRoot, CACHE_DIR_REL);
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    const cachePath = join(projectRoot, CACHE_FILE_REL);
    writeFileSync(cachePath, JSON.stringify(payload), "utf8");
  } catch {
    // Best-effort — failing to persist cache is not an error
  }
}

/**
 * Return mounted store directories in the project's read-set
 * (`required_stores` plus implicit personal). This hook helper is deliberately
 * tiny and best-effort: malformed config degrades to an empty read-set rather
 * than throwing during a shell hook.
 */
function _readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function _globalRoot() {
  return join(process.env.FABRIC_HOME || homedir(), ".fabric");
}

function _storeDir(globalRoot, store) {
  return join(globalRoot, "stores", store.mount_name || store.store_uuid);
}

function _readSetStoreDirs(projectRoot) {
  const globalRoot = _globalRoot();
  const global = _readJson(join(globalRoot, GLOBAL_CONFIG_FILE));
  if (!global || !Array.isArray(global.stores)) return [];
  const project = _readJson(join(projectRoot, PROJECT_CONFIG_REL)) || {};
  const required = Array.isArray(project.required_stores) ? project.required_stores : [];
  const stores = [];

  for (const req of required) {
    if (!req || typeof req.id !== "string") continue;
    const matched = global.stores.find(
      (store) => store && !store.personal && (store.alias === req.id || store.store_uuid === req.id),
    );
    if (matched) stores.push(matched);
  }

  const personal = global.stores.find((store) => store && store.personal);
  if (personal) stores.push(personal);

  return stores.map((store) => ({
    alias: typeof store.alias === "string" ? store.alias : "",
    dir: _storeDir(globalRoot, store),
  }));
}

function _splitQualifiedId(id) {
  const idx = typeof id === "string" ? id.indexOf(":") : -1;
  if (idx <= 0) return { alias: "", stableId: id };
  return { alias: id.slice(0, idx), stableId: id.slice(idx + 1) };
}

/**
 * Scan mounted store `knowledge/<type>/` for the canonical `<id>--<slug>.md`
 * matching `stableId`. Tries the most likely type-dir first based on the
 * entry's `type` hint, then falls back to scanning all canonical type
 * directories. Returns the absolute path or null.
 *
 * The id→file mapping is unique by construction (stable_id is allocated
 * once per file), so the first match wins.
 */
function _findEntryFile(projectRoot, stableId, typeHint) {
  const parsedId = _splitQualifiedId(stableId);
  const storeDirs = _readSetStoreDirs(projectRoot).filter(
    (store) => parsedId.alias.length === 0 || store.alias === parsedId.alias,
  );
  if (storeDirs.length === 0) return null;
  const tryOrder = [];
  if (typeof typeHint === "string" && typeHint.length > 0) {
    // Accept both singular and plural hints — find the plural form.
    const lower = typeHint.toLowerCase();
    const plural = KNOWLEDGE_TYPE_DIRS.find((d) => d === lower || d.startsWith(lower));
    if (plural) tryOrder.push(plural);
  }
  for (const t of KNOWLEDGE_TYPE_DIRS) {
    if (!tryOrder.includes(t)) tryOrder.push(t);
  }
  const prefix = `${parsedId.stableId}--`;
  for (const store of storeDirs) {
    const baseDir = join(store.dir, "knowledge");
    if (!existsSync(baseDir)) continue;
    for (const t of tryOrder) {
      const typeDir = join(baseDir, t);
      if (!existsSync(typeDir)) continue;
      let files;
      try {
        files = readdirSync(typeDir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (f.startsWith(prefix) && f.endsWith(".md")) {
          return join(typeDir, f);
        }
      }
    }
  }
  return null;
}

function _resolveOne(projectRoot, entry) {
  const filePath = _findEntryFile(projectRoot, entry.id, entry.type);
  if (filePath === null) return "";
  let md;
  try {
    md = readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
  return _extractFirstSummaryParagraph(md);
}

/**
 * Main API. Returns a new array of entries with `summary` swapped for
 * the extracted fallback wherever the original summary was opaque AND
 * the fallback extraction yielded a non-empty string. Non-opaque entries
 * pass through unchanged.
 */
function resolveOpaqueSummaries(entries, projectRoot, revisionHash) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;
  const cache = _readCache(projectRoot);
  const cachedSummaries = cache && cache.revision === revisionHash && cache.summaries ? cache.summaries : {};
  const nextCacheSummaries = { ...cachedSummaries };
  let cacheChanged = cache === null || cache.revision !== revisionHash;
  const result = entries.map((entry) => {
    if (!_isOpaque(entry)) return entry;
    const id = entry.id;
    let fallback;
    if (Object.prototype.hasOwnProperty.call(cachedSummaries, id)) {
      fallback = cachedSummaries[id];
    } else {
      fallback = _resolveOne(projectRoot, entry);
      nextCacheSummaries[id] = fallback;
      cacheChanged = true;
    }
    if (typeof fallback === "string" && fallback.length > 0) {
      return { ...entry, summary: fallback };
    }
    return entry;
  });
  if (cacheChanged) {
    _writeCache(projectRoot, { revision: revisionHash, summaries: nextCacheSummaries });
  }
  return result;
}

module.exports = {
  resolveOpaqueSummaries,
  _extractFirstSummaryParagraph,
  _readCache,
  _writeCache,
  _findEntryFile,
  _readSetStoreDirs,
  _isOpaque,
  SUMMARY_MAX_LEN,
  KNOWLEDGE_TYPE_DIRS,
};
