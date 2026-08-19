import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { platform } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";

import {
  collectStoreCanonicalEntries,
  computeReadSetRevision,
  type StoreCanonicalEntry,
} from "@fenglimg/fabric-server";

import { paint } from "../colors.js";
import { collectGlobalConfigView } from "../console/global-config-view.js";
import {
  applyGlobalConfigEdit,
  type ConfigWriteRequest,
} from "../console/global-config-write.js";
import { openKnowledgeEntry, type Opener } from "../console/open-entry.js";
import { isSameOriginLoopback } from "../console/security.js";
import { collectConsoleStatus } from "../console/status.js";
import { t } from "../i18n.js";
import { loadProjectConfig } from "../store/project-config-io.js";

// ---------------------------------------------------------------------------
// `fabric preview` — loopback-only, read-only knowledge preview server.
//
// KT-DEC-0016 quarantined the full HTTP `serve` (MCP-over-HTTP + events + bearer
// auth) because it had zero consumers and carried an attack-surface maintenance
// tax — but EXPLICITLY kept the door open for a future web UI. This IS that web
// UI, built deliberately minimal to honor that decision's spirit rather than
// un-quarantining the heavy server:
//   - binds 127.0.0.1 ONLY (never 0.0.0.0) — no remote reachability;
//   - GET-only, read-only endpoints — nothing is mutable, so no auth is needed
//     (the quarantine's bearer-auth/default-deny tax existed to guard a mutable
//     surface this command simply does not expose);
//   - reads knowledge LIVE from the mounted stores via collectStoreCanonicalEntries
//     (shared store read path with first-hit's createStoreResolver/listStoreKnowledge
//     lineage — NOT a second knowledge listing model; NOT retired co-location
//     readAgentsMeta the quarantined /api/rules was built on);
//   - the browser frontend (templates/preview/lumen.html) groups entries by
//     semantic_scope (KT-MOD-0001 three-axis: team / project:<id> / personal) and
//     polls /api/revision (computeReadSetRevision) to auto-refresh on change.
// ---------------------------------------------------------------------------

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;

// The ONLY addresses this server may bind. Enforced in startPreviewServer, and
// deliberately not reachable from the CLI at all — there is no `--host` flag.
//
// There used to be one. The file header and the listen() call both asserted
// "binds 127.0.0.1 ONLY (never 0.0.0.0)" while `--host 0.0.0.0` sat in the same
// file and did exactly that. Comments are not a gate; the console-shell task
// added a write channel, at which point the flag would have meant "any machine
// on the LAN can rewrite this machine's Fabric config".
//
// `host` survives as an internal option so tests can exercise the guard. Bad
// values THROW rather than silently falling back to 127.0.0.1 — a silent
// downgrade lets a misconfigured caller believe it succeeded.
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// Every mutating route, in one place. Membership is what turns on the POST-only
// + loopback-Origin guard in the request dispatcher.
// Note the write path is `/api/config/set`, NOT `/api/config`. Membership here
// means "every method other than POST is refused", so a read and a write cannot
// share one path without carving an exception into the guard — and an exception
// is precisely what makes a table-driven guard stop being a guarantee.
const WRITE_ROUTES = new Set(["/api/open", "/api/config/set"]);

const STATIC_ASSETS: Record<string, { file: string; type: string }> = {
  "/assets/shell.css": { file: "console/shell.css", type: "text/css; charset=utf-8" },
  "/assets/shell.js": { file: "console/shell.js", type: "text/javascript; charset=utf-8" },
};

export interface PreviewEntry {
  id: string;
  qualifiedId: string;
  store: string;
  type: string;
  scope: string;
  title: string;
  // Full archival summary (frontmatter `summary`) — shown in the detail pane
  // body, NOT as the list/detail title (title uses the concise-first chain).
  summary: string | undefined;
  maturity: string | undefined;
  createdAt: string | undefined;
  tags: string[];
  // The entry's `related` graph edges — LOCAL stable_ids (e.g. "KT-GLD-0019")
  // this entry links to. Same-store by the KT→KP privacy iron law, so the graph
  // resolves them within the entry's store. Powers the relationship graph view.
  related: string[];
  // Frontmatter `deprecated: true` (deprecate-over-delete). The list/graph views
  // dim these so a retired entry is visibly distinct from a live one.
  deprecated: boolean;
  body: string;
}

// Regex-based frontmatter access — mirrors the codebase's intentionally
// dependency-free frontmatter handling (knowledge-meta-builder.ts).
function readFrontmatterField(source: string, field: string): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u.exec(source);
  if (frontmatter === null) return undefined;
  const match = new RegExp(String.raw`^${field}:\s*(.+?)\s*$`, "mu").exec(frontmatter[1]);
  if (match === null) return undefined;
  return match[1].replace(/^["'](.*)["']$/u, "$1").trim();
}

// Parse an inline-array frontmatter field (`related: [KT-GLD-0019, KT-PRO-0011]`
// or bare `related: KT-GLD-0019`) into trimmed string ids. Mirrors the
// dependency-free regex frontmatter convention above; unquotes each element and
// drops empties. Returns [] when the field is absent.
function readFrontmatterList(source: string, field: string): string[] {
  const raw = readFrontmatterField(source, field);
  if (raw === undefined) return [];
  return raw
    .replace(/^\[(.*)\]$/u, "$1")
    .split(",")
    .map((s) => s.trim().replace(/^["'](.*)["']$/u, "$1").trim())
    .filter((s) => s.length > 0);
}

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u, "").replace(/^\s+/u, "");
}

// First `# ` heading of a frontmatter-stripped body. Second link of the
// title chain — most legacy entries carry a concise Chinese H1.
export function extractH1Title(body: string): string | undefined {
  const match = /^#\s+(.+?)\s*$/mu.exec(body);
  return match === null ? undefined : match[1].trim();
}

// First sentence of the archival summary, clamped to 40 chars — the
// user-locked "中文优先" fallback for entries with neither `title:` nor an H1
// (e.g. the wespy corpus). Never an English slug (rejected in a prior session).
export function firstSentence(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  const cut = trimmed.split(/(?<=[。！？!?])|(?<=[.])\s|\r?\n/u)[0]!.trim();
  return cut.length > 40 ? `${cut.slice(0, 40)}…` : cut;
}

// qualifiedId is `<alias>:<stableId>` (S61). Neither segment contains ':', so
// the alias is everything before the trailing `:<stableId>`.
function storeAliasOf(entry: StoreCanonicalEntry): string {
  const cut = entry.qualifiedId.length - entry.stableId.length - 1;
  return cut > 0 ? entry.qualifiedId.slice(0, cut) : entry.layer;
}

export function toPreviewEntry(entry: StoreCanonicalEntry): PreviewEntry {
  // Scope truth: parse the raw body's frontmatter first (always present),
  // fall back to the parsed description, then to the id-prefix-derived layer.
  const scope =
    readFrontmatterField(entry.body, "semantic_scope") ??
    entry.description.semantic_scope ??
    entry.layer;
  const body = stripFrontmatter(entry.body);
  // Title chain (census-verified, user-locked): frontmatter `title:` (universal
  // in fabric-team, always concise Chinese) → body H1 → summary first sentence
  // (40-char clamp) → stableId. Deliberately NOT the meta-builder's
  // rule-description extractor — its summary-first priority is the opposite of
  // what a display title needs.
  const title =
    readFrontmatterField(entry.body, "title") ??
    extractH1Title(body) ??
    firstSentence(entry.description.summary) ??
    entry.stableId;
  return {
    id: entry.stableId,
    qualifiedId: entry.qualifiedId,
    store: storeAliasOf(entry),
    type: entry.type,
    scope,
    title,
    summary: entry.description.summary,
    maturity: entry.description.maturity,
    createdAt: entry.description.created_at ?? readFrontmatterField(entry.body, "created_at"),
    tags: entry.description.tags ?? [],
    related: readFrontmatterList(entry.body, "related"),
    deprecated: readFrontmatterField(entry.body, "deprecated") === "true",
    body,
  };
}

// Walk up from this module for `templates/<rel>` — works in dev (src), under
// vitest (src), and bundled (dist). Mirrors inspect.ts#findTemplatePath.
function findTemplatePath(relativePath: string): string {
  const startDir = dirname(fileURLToPath(import.meta.url));
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, "templates", relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      throw new Error(`Template not found: templates/${relativePath} (searched up from ${startDir})`);
    }
    current = parent;
  }
}


// ---------------------------------------------------------------------------
// The relationship graph (`/graph`) is a self-contained page: templates/console/
// graph.html, served like every other page. It used to be a 270-line template
// literal inside this file with its own hand-copied palette — the second copy of
// tokens that also live in lumen.html, with nothing to notice when they drifted.
// Pages are files; this file routes to them.
// ---------------------------------------------------------------------------

// Best-effort browser open — failure is non-fatal (the URL is always printed).
function openBrowser(url: string): void {
  const [command, args] =
    platform() === "darwin"
      ? ["open", [url]]
      : platform() === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(command as string, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best-effort — the URL is printed regardless */
  }
}

// Read a small JSON request body. Capped because an unbounded read on a
// long-lived local server is a trivial memory sink, and every console payload is
// a handful of fields. A malformed or oversized body yields null; callers treat
// that as a missing field rather than crashing the request.
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const MAX_BYTES = 64 * 1024;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BYTES) return null;
    chunks.push(buf);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

export interface RunPreviewOptions {
  // Internal only — NOT exposed as a CLI flag. Must be one of ALLOWED_HOSTS or
  // startPreviewServer throws. Exists so tests can exercise that guard.
  host?: string;
  port?: number;
  target?: string;
  // When true, `/api/knowledge` defaults to walking EVERY machine-mounted store
  // (bypassing the project read-set) instead of only this project's read-set.
  // Per request, `?all=1` / `?all=0` overrides this default without a restart.
  allStores?: boolean;
  // Injectable so tests can assert POST /api/open dispatches without launching a
  // real program. Production leaves it undefined and gets the OS opener.
  opener?: Opener;
}

export interface PreviewServerHandle {
  url: string;
  // The port the server actually bound. Differs from the requested port when
  // that port was in use and we fell back to an OS-assigned free port.
  port: number;
  // True when the requested port was busy (EADDRINUSE) and we auto-fell back to
  // an ephemeral port — the caller can surface a note so the user isn't
  // surprised the URL's port changed.
  portWasBusy: boolean;
  close: () => Promise<void>;
}

export async function startPreviewServer(options: RunPreviewOptions = {}): Promise<PreviewServerHandle> {
  const projectRoot = options.target ? resolve(options.target) : process.cwd();
  const host = options.host ?? LOOPBACK_HOST;
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `refusing to bind ${host}: fabric preview is loopback-only (allowed: ${[...ALLOWED_HOSTS].join(", ")})`,
    );
  }
  const port = options.port ?? DEFAULT_PORT;
  const defaultAllStores = options.allStores === true;
  // Filled in after listen(): the Origin check compares against the port that
  // was actually bound, which differs from `port` whenever 7777 was busy and we
  // fell back. Comparing against the requested port would reject every genuine
  // request on a fallback port.
  let boundPort = port;

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? "GET";
        const reqUrl = new URL(req.url ?? "/", `http://${host}`);
        const pathname = reqUrl.pathname;

        // Write routes are declared in one table and guarded HERE, before any
        // handler runs. The alternative — each handler calling the guard on its
        // own first line — makes "forgot to guard the new endpoint" a silent,
        // type-checking, test-passing, lint-clean defect. Unreachable-by-default
        // beats remembering.
        if (WRITE_ROUTES.has(pathname)) {
          if (method !== "POST") {
            sendJson(res, 405, { error: "method not allowed: write endpoints are POST" });
            return;
          }
          const verdict = isSameOriginLoopback(
            { origin: req.headers.origin, host: req.headers.host },
            boundPort,
          );
          if (!verdict.ok) {
            sendJson(res, 403, { error: `refused: ${verdict.reason}` });
            return;
          }
          if (pathname === "/api/open") {
            const body = await readJsonBody(req);
            const result = await openKnowledgeEntry(
              projectRoot,
              (body as { qualifiedId?: unknown } | null)?.qualifiedId,
              options.opener,
            );
            if (result.ok) sendJson(res, 200, { ok: true });
            else sendJson(res, result.status, { error: result.error });
            return;
          }
          if (pathname === "/api/config/set") {
            const body = (await readJsonBody(req)) as ConfigWriteRequest | null;
            // The write target is named by the request and validated against the
            // server's own enumerated sets; `projectRoot` does NOT select the
            // target. It is passed for one reason only — the set it is validated
            // against must be the same set `/api/config` rendered, and that set
            // includes the synthesized row for an unregistered current project.
            // See global-config-write.ts.
            const result = await applyGlobalConfigEdit(body, projectRoot);
            if (result.ok) sendJson(res, 200, { ok: true, target: result.target });
            else sendJson(res, result.status, { error: result.error });
            return;
          }
        }

        if (method !== "GET") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }

        // Shared shell assets. A fixed whitelist rather than "serve anything
        // under templates/console/" — a directory-backed static handler is one
        // missing path check away from serving the whole repo, and this console
        // has exactly two shared assets.
        const asset = STATIC_ASSETS[pathname];
        if (asset !== undefined) {
          const body = readFileSync(findTemplatePath(asset.file), "utf8");
          res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
          res.end(body);
          return;
        }

        if (pathname === "/" || pathname === "/index.html") {
          // The single template (templates/preview/lumen.html) — read per
          // request so live edits show on a refresh (no server restart).
          const html = readFileSync(findTemplatePath("preview/lumen.html"), "utf8");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(html);
          return;
        }
        // /graph — the relationship graph module (self-contained view). It reads
        // /api/knowledge?all= client-side, so no server data is inlined here.
        if (pathname === "/graph") {
          const html = readFileSync(findTemplatePath("console/graph.html"), "utf8");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(html);
          return;
        }
        if (pathname === "/api/knowledge") {
          // Source selection: `?all=1` walks every mounted store, `?all=0` forces
          // the project read-set, absent falls back to the server's default (the
          // --all flag). Lets a future UI toggle switch source without a restart.
          const allParam = new URL(req.url ?? "/", `http://${host}`).searchParams.get("all");
          const allStores =
            allParam === null ? defaultAllStores : allParam === "1" || allParam === "true";
          const entries = await collectStoreCanonicalEntries(projectRoot, { allStores });
          // writeStore lets the sidebar order the current project's write-target
          // store group first. Read live (cheap) so a switch-write shows on refresh.
          const writeStore = loadProjectConfig(projectRoot)?.active_write_store ?? null;
          sendJson(res, 200, { entries: entries.map(toPreviewEntry), writeStore });
          return;
        }
        if (pathname === "/api/revision") {
          sendJson(res, 200, { revision: await computeReadSetRevision(projectRoot) });
          return;
        }
        if (pathname === "/status") {
          const html = readFileSync(findTemplatePath("console/status.html"), "utf8");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(html);
          return;
        }
        if (pathname === "/config") {
          const html = readFileSync(findTemplatePath("console/config.html"), "utf8");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        }

        if (pathname === "/api/config") {
          // `projectRoot` contributes exactly one thing downstream — which
          // project is flagged `isCurrent`. Everything else comes off the
          // machine's own state.
          sendJson(res, 200, await collectGlobalConfigView(projectRoot));
          return;
        }

        if (pathname === "/api/status") {
          sendJson(res, 200, await collectConsoleStatus(projectRoot));
          return;
        }
        sendJson(res, 404, { error: "not found" });
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  // Loopback ONLY — never bind 0.0.0.0 (KT-DEC-0016 attack-surface boundary).
  const listenOn = (p: number): Promise<void> =>
    new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error): void => rejectListen(error);
      server.once("error", onError);
      server.listen(p, host, () => {
        server.off("error", onError);
        resolveListen();
      });
    });

  // Port auto-fallback: a busy port (EADDRINUSE — e.g. a second `fabric preview`,
  // or the default 7777 already taken) must not crash the command. Retry once on
  // an OS-assigned ephemeral port (listen 0); the printed URL reflects the real
  // bound port. `port === 0` was already ephemeral, so nothing to fall back to.
  let portWasBusy = false;
  try {
    await listenOn(port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE" && port !== 0) {
      portWasBusy = true;
      await listenOn(0);
    } else {
      throw error;
    }
  }

  const address = server.address();
  boundPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    url: `http://${host}:${boundPort}/`,
    port: boundPort,
    portWasBusy,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

export const previewCommand = defineCommand({
  meta: {
    name: "preview",
    description: t("cli.preview.description"),
  },
  args: {
    port: {
      type: "string",
      description: t("cli.preview.arg.port"),
    },
    open: {
      type: "boolean",
      description: t("cli.preview.arg.open"),
      default: true,
    },
    target: {
      type: "string",
      description: t("cli.preview.arg.target"),
    },
    all: {
      type: "boolean",
      description: t("cli.preview.arg.all"),
      default: false,
    },
  },
  async run({
    args,
  }: {
    args: { port?: string; open?: boolean; target?: string; all?: boolean };
  }) {
    try {
      const port = args.port === undefined ? DEFAULT_PORT : Number.parseInt(args.port, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`invalid port: ${String(args.port)}`);
      }
      const handle = await startPreviewServer({
        port,
        target: typeof args.target === "string" ? args.target : undefined,
        allStores: args.all === true,
      });

      process.stdout.write(`${paint.success("✓")} ${t("cli.preview.started", { url: paint.accent(handle.url) })}\n`);
      if (handle.portWasBusy) {
        process.stdout.write(
          `${paint.muted(t("cli.preview.port-fallback", { requested: String(port), actual: String(handle.port) }))}\n`,
        );
      }
      if (args.open !== false) {
        process.stdout.write(`${paint.muted(t("cli.preview.opening"))}\n`);
        openBrowser(handle.url);
      }
      process.stdout.write(`${paint.muted(t("cli.preview.stop-hint"))}\n`);

      await new Promise<void>((resolveRun) => {
        const shutdown = (): void => {
          void handle.close().then(() => resolveRun());
        };
        process.once("SIGINT", () => {
          process.stdout.write(`\n${paint.muted(t("cli.preview.stopped"))}\n`);
          shutdown();
        });
        process.once("SIGTERM", shutdown);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${paint.error("✗")} ${t("cli.preview.error", { message })}\n`);
      process.exitCode = 1;
    }
  },
});

export default previewCommand;
