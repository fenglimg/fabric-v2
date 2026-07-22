import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
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
import { t } from "../i18n.js";

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
//   - the browser frontend (templates/preview/index.html) groups entries by
//     semantic_scope (KT-MOD-0001 three-axis: team / project:<id> / personal) and
//     polls /api/revision (computeReadSetRevision) to auto-refresh on change.
// ---------------------------------------------------------------------------

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
// The variant `/` lands on by default; the full side-by-side gallery is at
// /gallery. Overridable per-run with `--variant`.
const DEFAULT_VARIANT = "lumen";

export interface PreviewEntry {
  id: string;
  qualifiedId: string;
  store: string;
  type: string;
  scope: string;
  title: string;
  maturity: string | undefined;
  createdAt: string | undefined;
  tags: string[];
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

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u, "").replace(/^\s+/u, "");
}

// qualifiedId is `<alias>:<stableId>` (S61). Neither segment contains ':', so
// the alias is everything before the trailing `:<stableId>`.
function storeAliasOf(entry: StoreCanonicalEntry): string {
  const cut = entry.qualifiedId.length - entry.stableId.length - 1;
  return cut > 0 ? entry.qualifiedId.slice(0, cut) : entry.layer;
}

function toPreviewEntry(entry: StoreCanonicalEntry): PreviewEntry {
  // Scope truth: parse the raw body's frontmatter first (always present),
  // fall back to the parsed description, then to the id-prefix-derived layer.
  const scope =
    readFrontmatterField(entry.body, "semantic_scope") ??
    entry.description.semantic_scope ??
    entry.layer;
  return {
    id: entry.stableId,
    qualifiedId: entry.qualifiedId,
    store: storeAliasOf(entry),
    type: entry.type,
    scope,
    title: entry.description.summary ?? entry.stableId,
    maturity: entry.description.maturity,
    createdAt: entry.description.created_at ?? readFrontmatterField(entry.body, "created_at"),
    tags: entry.description.tags ?? [],
    body: stripFrontmatter(entry.body),
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

// Style variants live as self-contained HTML under templates/preview/variants/.
// Each hits the same /api/knowledge + /api/revision contract; the gallery ("/")
// embeds them side by side so the user can compare and pick one. Variants are
// read per request, so agy's live edits show on a refresh (no server restart).
function variantsDir(): string {
  return findTemplatePath("preview/variants");
}

interface VariantInfo {
  name: string;
  title: string;
  desc: string;
}

function listVariants(): VariantInfo[] {
  let files: string[];
  try {
    files = readdirSync(variantsDir()).filter((file) => file.endsWith(".html"));
  } catch {
    return [];
  }
  const dir = variantsDir();
  return files
    .map((file) => {
      const name = file.replace(/\.html$/u, "");
      let html = "";
      try {
        html = readFileSync(join(dir, file), "utf8");
      } catch {
        /* unreadable variant is simply skipped from its metadata */
      }
      const title = /<title>([^<]*)<\/title>/iu.exec(html)?.[1]?.trim() ?? name;
      const desc = /<meta\s+name=["']variant-desc["']\s+content=["']([^"']*)["']/iu.exec(html)?.[1]?.trim() ?? "";
      return { name, title, desc };
    })
    // baseline first, then alphabetical — a stable, predictable gallery order.
    .sort((a, b) => (a.name === "baseline" ? -1 : b.name === "baseline" ? 1 : a.name.localeCompare(b.name)));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&quot;";
  });
}

// A stable marker so a test (and a human viewing source) can assert the toggle
// was injected. Also guards against double-injection.
const SOURCE_TOGGLE_MARKER = "fabric-source-toggle";

// The knowledge source toggle ("本项目 / 全部") is injected SERVER-SIDE into every
// style variant rather than authored into each of the 7 bespoke templates:
//   - ONE source of truth — new variants get it for free, no per-template churn;
//   - keeps the variant HTML as pure STYLE artifacts (agy owns them) while this
//     functional control (which drives /api/knowledge?all=) stays app logic.
// It (a) wraps window.fetch so every /api/knowledge request carries the current
// selection (persisted in sessionStorage, default = this-project read-set), and
// (b) renders a fixed-position two-segment toggle that flips the flag and calls
// the variant's global loadKnowledge() for an instant re-render. The wrapper is
// injected into <head> so it is installed BEFORE the variant's body script fires
// its first load — a prior "全部" selection survives a refresh.
const SOURCE_TOGGLE_SNIPPET = `<script>(function(){
  var KEY='fabricPreviewAllStores';
  function allOn(){try{return sessionStorage.getItem(KEY)==='1'}catch(e){return false}}
  var _fetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    try{
      var url=(typeof input==='string')?input:(input&&input.url);
      if(url&&url.indexOf('/api/knowledge')===0){
        var u=url+(url.indexOf('?')===-1?'?':'&')+'all='+(allOn()?'1':'0');
        input=(typeof input==='string')?u:new Request(u,input);
      }
    }catch(e){}
    return _fetch(input,init);
  };
  // Variant scripts run inside an IIFE, so their loadKnowledge() is NOT a global
  // we can call. Re-fetch via a full reload: the fetch wrapper above is installed
  // in <head> BEFORE the variant's body script fires its first load, and the
  // selection persists in sessionStorage — so the reloaded page renders the new
  // source immediately.
  function reload(){location.reload()}
  function mount(){
    if(document.getElementById('${SOURCE_TOGGLE_MARKER}'))return;
    var wrap=document.createElement('div');
    wrap.id='${SOURCE_TOGGLE_MARKER}';wrap.setAttribute('role','group');
    wrap.style.cssText='position:fixed;right:14px;bottom:14px;z-index:99999;display:flex;'+
      'font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;'+
      'background:rgba(127,127,127,.14);border:1px solid rgba(127,127,127,.28);border-radius:9px;'+
      'padding:3px;backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.16)';
    function seg(label,on){
      var b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.on=on?'1':'0';
      b.style.cssText='border:0;cursor:pointer;padding:6px 12px;border-radius:6px;color:inherit;background:transparent;transition:all .12s';
      b.onclick=function(){try{sessionStorage.setItem(KEY,on?'1':'0')}catch(e){}paint();reload()};
      return b;
    }
    var proj=seg('本项目',false),all=seg('全部',true);
    function paint(){[proj,all].forEach(function(b){
      var active=(b.dataset.on==='1')===allOn();
      b.style.opacity=active?'1':'.6';b.style.background=active?'rgba(127,127,127,.3)':'transparent';
    })}
    wrap.appendChild(proj);wrap.appendChild(all);paint();document.body.appendChild(wrap);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();</script>`;

// Inject the toggle snippet just before </head> (so its fetch-wrapper installs
// before the variant's body script runs). No </head> (or already injected) →
// return unchanged, so a malformed template still serves.
function injectSourceToggle(html: string): string {
  if (html.includes(SOURCE_TOGGLE_MARKER)) return html;
  const idx = html.toLowerCase().indexOf("</head>");
  if (idx === -1) return html;
  return html.slice(0, idx) + SOURCE_TOGGLE_SNIPPET + html.slice(idx);
}

function renderGallery(variants: VariantInfo[]): string {
  const cards =
    variants.length === 0
      ? '<p class="empty">还没有样式变体。等 agy 生成后刷新本页即可看到。</p>'
      : variants
          .map(
            (v) => `
      <section class="card">
        <div class="bar">
          <div class="meta"><span class="vname">${escapeHtml(v.title)}</span><span class="vdesc">${escapeHtml(v.desc)}</span></div>
          <a class="full" href="/v/${encodeURIComponent(v.name)}" target="_blank" rel="noopener">全屏打开 ↗</a>
        </div>
        <div class="frame"><iframe src="/v/${encodeURIComponent(v.name)}?embed=1" loading="lazy" title="${escapeHtml(v.title)}"></iframe></div>
      </section>`,
          )
          .join("");
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fabric 预览 · 挑一个样式</title>
<style>
  :root { --bg:#f6f6f4; --surface:#fff; --border:#e5e3de; --text:#1f1e1c; --text2:#6b6862; --accent:#3a6ff0; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161512; --surface:#232220; --border:#383632; --text:#ecebe8; --text2:#a8a49c; } }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; background:var(--bg); color:var(--text); }
  .head { padding:22px 28px 8px; } .head h1 { margin:0 0 4px; font-size:20px; font-weight:600; } .head p { margin:0; color:var(--text2); font-size:14px; }
  .wrap { padding:16px 28px 60px; display:flex; flex-direction:column; gap:22px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; }
  .bar { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border); gap:12px; }
  .vname { font-weight:600; font-size:15px; margin-right:10px; } .vdesc { color:var(--text2); font-size:13px; }
  .full { color:var(--accent); text-decoration:none; font-size:13px; white-space:nowrap; } .full:hover { text-decoration:underline; }
  .frame { height:600px; background:var(--bg); } iframe { width:100%; height:100%; border:0; display:block; }
  .empty { color:var(--text2); padding:40px 28px; }
</style></head><body>
<div class="head"><h1>挑一个样式预览</h1><p>各风格实时预览(数据同源)。点「全屏打开」看完整交互;选好告诉我名字,我把它设为默认。</p></div>
<div class="wrap">${cards}</div>
</body></html>`;
}

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

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

export interface RunPreviewOptions {
  host?: string;
  port?: number;
  target?: string;
  variant?: string;
  // When true, `/api/knowledge` defaults to walking EVERY machine-mounted store
  // (bypassing the project read-set) instead of only this project's read-set.
  // Per request, `?all=1` / `?all=0` overrides this default without a restart.
  allStores?: boolean;
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
  const port = options.port ?? DEFAULT_PORT;
  const defaultVariant = options.variant ?? DEFAULT_VARIANT;
  const defaultAllStores = options.allStores === true;

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        const reqUrl = new URL(req.url ?? "/", `http://${host}`);
        const pathname = reqUrl.pathname;
        // The gallery embeds each variant in an iframe as `?embed=1`; those inner
        // frames suppress the source toggle (one toggle per mini-preview would be
        // clutter, and each would only steer its own frame's data).
        const isEmbed = reqUrl.searchParams.get("embed") === "1";

        if (pathname === "/" || pathname === "/index.html") {
          // Default landing = the chosen default variant; the full side-by-side
          // gallery lives at /gallery. Fall back to the gallery if the default
          // variant file is missing.
          const defaultFile = join(variantsDir(), `${defaultVariant}.html`);
          // Inject the source toggle only into the variant view, never the
          // gallery fallback (its iframes carry their own suppressed variants).
          const html = existsSync(defaultFile)
            ? injectSourceToggle(readFileSync(defaultFile, "utf8"))
            : renderGallery(listVariants());
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(html);
          return;
        }
        if (pathname === "/gallery") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(renderGallery(listVariants()));
          return;
        }
        // /v/<name> — a single style variant. Name is one path segment; reject
        // traversal and unknown variants.
        if (pathname.startsWith("/v/")) {
          const name = decodeURIComponent(pathname.slice("/v/".length));
          if (!/^[a-z0-9_-]+$/iu.test(name)) {
            sendJson(res, 400, { error: "invalid variant name" });
            return;
          }
          const file = join(variantsDir(), `${name}.html`);
          if (!existsSync(file)) {
            sendJson(res, 404, { error: `unknown variant: ${name}` });
            return;
          }
          const variantHtml = readFileSync(file, "utf8");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(isEmbed ? variantHtml : injectSourceToggle(variantHtml));
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
          sendJson(res, 200, { entries: entries.map(toPreviewEntry) });
          return;
        }
        if (pathname === "/api/revision") {
          sendJson(res, 200, { revision: await computeReadSetRevision(projectRoot) });
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
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
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
    host: {
      type: "string",
      description: t("cli.preview.arg.host"),
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
    variant: {
      type: "string",
      description: t("cli.preview.arg.variant"),
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
    args: { port?: string; host?: string; open?: boolean; target?: string; variant?: string; all?: boolean };
  }) {
    try {
      const port = args.port === undefined ? DEFAULT_PORT : Number.parseInt(args.port, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`invalid port: ${String(args.port)}`);
      }
      const handle = await startPreviewServer({
        host: typeof args.host === "string" && args.host.length > 0 ? args.host : undefined,
        port,
        target: typeof args.target === "string" ? args.target : undefined,
        variant: typeof args.variant === "string" && args.variant.length > 0 ? args.variant : undefined,
        allStores: args.all === true,
      });

      process.stdout.write(`${paint.success("✓")} ${t("cli.preview.started", { url: paint.accent(handle.url) })}\n`);
      if (handle.portWasBusy) {
        process.stdout.write(
          `${paint.muted(t("cli.preview.port-fallback", { requested: String(port), actual: String(handle.port) }))}\n`,
        );
      }
      process.stdout.write(`${paint.muted(t("cli.preview.gallery-hint", { url: `${handle.url}gallery` }))}\n`);
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
