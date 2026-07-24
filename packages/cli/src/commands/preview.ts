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

// A fixed control bar is injected SERVER-SIDE into every style variant rather
// than authored into each of the 7 bespoke templates:
//   - ONE source of truth — new variants get it for free, no per-template churn;
//   - keeps the variant HTML as pure STYLE artifacts (agy owns them) while these
//     functional controls (source selection + all-view store labels + deprecated
//     filter/mark) stay app logic.
// It wraps window.fetch so every /api/knowledge response is (a) tagged with the
// current source selection via ?all= (persisted in sessionStorage, default =
// this-project read-set), then (b) TRANSFORMED in place before the variant sees
// it — because all 7 variants group by `entry.scope` and render `entry.title`
// but none of them know about `store`/`deprecated`, decorating the shared JSON
// is the one layout-agnostic lever that reaches every template at once:
//   - #3 (all view): when "全部" is active, prefix each title with `[<store>]` so
//     which physical library an entry belongs to is visible per-row (scope
//     grouping already separates each `project:<id>`, so "哪个项目" is covered;
//     this fills the "哪个库" gap when multiple stores' team entries collapse).
//   - #9 (deprecated): mark deprecated entries in the title ("已弃用 · …") and,
//     when the user toggles the filter on, drop them from the list. Default is
//     SHOW+mark, honoring deprecate-over-delete discoverability (KT-DEC-0055):
//     a retired entry's rationale stays reachable, just visibly flagged.
// The wrapper is injected into <head> so it is installed BEFORE the variant's
// body script fires its first load — a prior selection survives a refresh. The
// /graph module is NOT injected (it renders its own view and dims deprecated
// nodes itself), so this decoration never touches the graph's data.
const SOURCE_TOGGLE_SNIPPET = `<script>(function(){
  var KEY='fabricPreviewAllStores', DEPKEY='fabricPreviewHideDeprecated';
  function allOn(){try{return sessionStorage.getItem(KEY)==='1'}catch(e){return false}}
  function hideDep(){try{return sessionStorage.getItem(DEPKEY)==='1'}catch(e){return false}}
  var _fetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    var isK=false;
    try{
      var url=(typeof input==='string')?input:(input&&input.url);
      if(url&&url.indexOf('/api/knowledge')===0){
        isK=true;
        var u=url+(url.indexOf('?')===-1?'?':'&')+'all='+(allOn()?'1':'0');
        input=(typeof input==='string')?u:new Request(u,input);
      }
    }catch(e){}
    var p=_fetch(input,init);
    if(!isK)return p;
    // Decorate the shared /api/knowledge payload in place: filter deprecated when
    // hidden, then mark titles (store prefix in all-view, deprecated flag always).
    // All 7 variants render entry.title, so this reaches every layout uniformly.
    return p.then(function(r){
      return r.json().then(function(d){
        var list=(d&&d.entries)||[];
        if(hideDep())list=list.filter(function(e){return !e.deprecated;});
        var showAll=allOn();
        list.forEach(function(e){
          if(e.deprecated)e.title='已弃用 · '+(e.title||'');
          if(showAll)e.title='['+(e.store||'?')+'] '+(e.title||'');
        });
        d.entries=list;
        return new Response(JSON.stringify(d),{status:r.status,statusText:r.statusText,
          headers:{'content-type':'application/json; charset=utf-8'}});
      }).catch(function(){return r;});
    });
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
    // Deprecated filter toggle: flips SHOW+mark ⇄ HIDE. Default (unset) = show, so
    // retired entries stay discoverable per KT-DEC-0055; the list marks them and
    // this lets a user hide the noise on demand.
    var dep=document.createElement('button');dep.type='button';
    dep.style.cssText='border:0;cursor:pointer;padding:6px 12px;border-radius:6px;color:inherit;background:transparent;'+
      'transition:all .12s;margin-left:2px;border-left:1px solid rgba(127,127,127,.28)';
    function paintDep(){var hidden=hideDep();dep.textContent=hidden?'弃用·隐藏':'弃用·显示';
      dep.style.opacity=hidden?'1':'.6';dep.style.background=hidden?'rgba(127,127,127,.3)':'transparent';}
    dep.onclick=function(){try{sessionStorage.setItem(DEPKEY,hideDep()?'0':'1')}catch(e){}paintDep();reload()};
    // Entry point to the relationship graph module; carries the current source
    // selection so the graph opens in the same scope the user is browsing.
    var graph=document.createElement('a');
    graph.textContent='⁙ 关联图';graph.href='/graph?all='+(allOn()?'1':'0');
    graph.style.cssText='display:flex;align-items:center;text-decoration:none;color:inherit;opacity:.72;'+
      'cursor:pointer;padding:6px 12px;border-radius:6px;margin-right:2px;border-right:1px solid rgba(127,127,127,.28)';
    wrap.appendChild(graph);wrap.appendChild(proj);wrap.appendChild(all);wrap.appendChild(dep);
    paint();paintDep();document.body.appendChild(wrap);
  }
  // #2/#6 truncation relief — template-agnostic. Any leaf element whose text is
  // clipped (scrollWidth > clientWidth: store name, semantic_scope chip, long
  // title) gets a native title= tooltip so the full value is one hover away. A
  // debounced MutationObserver re-scans as the variant renders/refreshes its
  // list, so it covers content that arrives after first paint.
  function titleTruncated(){
    var els=document.body.querySelectorAll('*');
    for(var i=0;i<els.length;i++){ var el=els[i];
      if(el.childElementCount===0 && el.scrollWidth>el.clientWidth+1){
        var t=(el.textContent||'').trim();
        if(t && el.getAttribute('title')!==t) el.setAttribute('title',t);
      }
    }
  }
  var tq=null;
  function scheduleTitles(){ if(tq)return; tq=setTimeout(function(){tq=null;try{titleTruncated()}catch(e){}},250); }
  function startTitles(){
    scheduleTitles();
    try{ new MutationObserver(scheduleTitles).observe(document.body,{childList:true,subtree:true,characterData:true}); }catch(e){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){mount();startTitles();});
  else {mount();startTitles();}
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

// ---------------------------------------------------------------------------
// Relationship graph module (`/graph`). A self-contained view — NOT a style
// variant — so the graph feature lives in ONE place (no 7-template churn) and
// the variants stay pure browse surfaces. It fetches /api/knowledge (honoring
// the ?all= source selection), builds nodes (entries) + edges (each entry's
// `related` ids resolved WITHIN its store — same-store by the KT→KP privacy
// law), runs a small dependency-free force simulation, and renders an
// interactive SVG (pan / wheel-zoom / node drag / hover-highlight neighbours).
// Nodes are coloured by scope (team/project/personal) and deprecated entries
// are dimmed. Client JS deliberately avoids template literals / ${} so it nests
// cleanly inside this server-side template literal.
// ---------------------------------------------------------------------------
function renderGraphView(): string {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fabric 预览 · 关联图</title>
<style>
  :root{--bg:#f6f6f4;--surface:#fff;--border:#e5e3de;--text:#1f1e1c;--text2:#6b6862;
    --team:#0d9488;--project:#2563eb;--personal:#7c3aed;--edge:rgba(120,120,120,.34);}
  @media (prefers-color-scheme:dark){:root{--bg:#161512;--surface:#232220;--border:#383632;--text:#ecebe8;--text2:#a8a49c;
    --team:#2dd4bf;--project:#60a5fa;--personal:#a78bfa;--edge:rgba(160,160,160,.26);}}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
  .bar{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:16px;
    padding:0 18px;background:var(--surface);border-bottom:1px solid var(--border);z-index:10}
  .bar h1{font-size:15px;font-weight:600;margin:0;white-space:nowrap}
  .bar .sp{flex:1}
  .bar a,.seg{text-decoration:none;color:var(--text2);font-size:13px;cursor:pointer;padding:5px 10px;border-radius:6px}
  .seg.active{color:var(--text);background:rgba(127,127,127,.16)}
  .legend{display:flex;gap:12px;font-size:12px;color:var(--text2);align-items:center;white-space:nowrap}
  .legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:middle}
  #stat{font-size:12px;color:var(--text2);white-space:nowrap}
  svg{position:fixed;top:52px;left:0;width:100vw;height:calc(100vh - 52px);cursor:grab;display:block}
  svg.pan{cursor:grabbing}
  .tip{position:fixed;pointer-events:none;z-index:20;max-width:340px;padding:8px 11px;border-radius:8px;
    background:var(--surface);border:1px solid var(--border);box-shadow:0 4px 18px rgba(0,0,0,.2);
    font-size:12px;line-height:1.55;opacity:0;transition:opacity .1s}
  .tip b{display:block;font-size:12px;margin-bottom:3px}
  .tip .m{color:var(--text2)}
  .empty{position:fixed;top:55%;left:0;right:0;text-align:center;color:var(--text2)}
</style></head><body>
<div class="bar">
  <h1>知识关联图</h1>
  <span class="legend"><span><i style="background:var(--team)"></i>团队</span>
    <span><i style="background:var(--project)"></i>项目</span>
    <span><i style="background:var(--personal)"></i>个人</span>
    <span style="opacity:.5"><i style="background:#9aa"></i>已弃用</span></span>
  <span id="stat"></span>
  <span class="sp"></span>
  <span class="seg" id="sProj">本项目</span><span class="seg" id="sAll">全部</span>
  <a href="/">← 返回列表</a>
</div>
<svg id="g"><g id="view"></g></svg><div class="tip" id="tip"></div>
<script>
(function(){
  var params=new URLSearchParams(location.search);
  var all=params.get('all')==='1';
  try{ if(params.get('all')!==null) sessionStorage.setItem('fabricPreviewAllStores', all?'1':'0'); }catch(e){}
  var sp=document.getElementById('sProj'), sa=document.getElementById('sAll');
  sp.className='seg'+(all?'':' active'); sa.className='seg'+(all?' active':'');
  sp.onclick=function(){location.href='/graph?all=0'}; sa.onclick=function(){location.href='/graph?all=1'};

  var SVGNS='http://www.w3.org/2000/svg';
  var svg=document.getElementById('g'), view=document.getElementById('view'), tip=document.getElementById('tip');
  function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}
  function color(root){return root==='personal'?cssVar('--personal'):root==='project'?cssVar('--project'):cssVar('--team');}
  // SVG presentation attributes do NOT resolve CSS var() — resolve to concrete colors once.
  var EDGE=cssVar('--edge'), BG=cssVar('--bg');
  // Layout runs in a FIXED virtual space; the SVG viewBox then scales it to fill
  // the element. This sidesteps reading the pane's pixel size (unreliable at load
  // in some embedded browsers) — the graph always fills and centers itself.
  var VW=1400, VH=900, vb={x:0,y:0,w:VW,h:VH};
  function applyVB(){ svg.setAttribute('viewBox', vb.x+' '+vb.y+' '+vb.w+' '+vb.h); }
  function clientToUser(cx,cy){ var pt=svg.createSVGPoint(); pt.x=cx; pt.y=cy; var m=svg.getScreenCTM(); return m?pt.matrixTransform(m.inverse()):{x:cx,y:cy}; }

  fetch('/api/knowledge?all='+(all?'1':'0'),{cache:'no-store'})
    .then(function(r){return r.json()})
    .then(function(d){ build(d.entries||[]); })
    .catch(function(e){ document.body.insertAdjacentHTML('beforeend','<div class="empty">加载失败: '+e.message+'</div>'); });

  var nodes=[], edges=[];
  function build(entries){
    nodes=entries.map(function(e,i){
      var root=(e.scope||'team').split(':')[0];
      var ang=i*2.399963, rad=Math.min(VW,VH)*0.44*Math.sqrt((i+1)/entries.length);
      return {id:e.qualifiedId, local:e.id, title:e.title||e.id, store:e.store, scope:e.scope||'team',
        root:root, dep:!!e.deprecated, deg:0, x:VW/2+Math.cos(ang)*rad, y:VH/2+Math.sin(ang)*rad, vx:0, vy:0};
    });
    var byKey={}; nodes.forEach(function(n){ byKey[n.store+'|'+n.local]=n; });
    var seen={};
    entries.forEach(function(e){
      var s=byKey[e.store+'|'+e.id]; if(!s) return;
      (e.related||[]).forEach(function(rid){
        var t=byKey[e.store+'|'+rid]; if(!t||t===s) return;
        var key=[s.id,t.id].sort().join('::'); if(seen[key]) return; seen[key]=1;
        edges.push({s:s,t:t}); s.deg++; t.deg++;
      });
    });
    document.getElementById('stat').textContent=nodes.length+' 条 · '+edges.length+' 关联';
    if(!nodes.length){ document.body.insertAdjacentHTML('beforeend','<div class="empty">该视角下暂无知识条目</div>'); return; }
    simulate(); paint(); fit(); wire();
  }

  function simulate(){
    var k=Math.min(VW,VH)/Math.sqrt(nodes.length)*0.9;
    for(var it=0; it<300; it++){
      for(var a=0;a<nodes.length;a++){ var na=nodes[a];
        for(var b=a+1;b<nodes.length;b++){ var nb=nodes[b];
          var dx=na.x-nb.x, dy=na.y-nb.y, dist=Math.sqrt(dx*dx+dy*dy)||0.01;
          var f=k*k/(dist*dist)*9, fx=dx/dist*f, fy=dy/dist*f;
          na.vx+=fx; na.vy+=fy; nb.vx-=fx; nb.vy-=fy;
        }
      }
      for(var e=0;e<edges.length;e++){ var ed=edges[e];
        var dx=ed.t.x-ed.s.x, dy=ed.t.y-ed.s.y, dist=Math.sqrt(dx*dx+dy*dy)||0.01;
        var f=(dist-k)*0.02, fx=dx/dist*f, fy=dy/dist*f;
        ed.s.vx+=fx; ed.s.vy+=fy; ed.t.vx-=fx; ed.t.vy-=fy;
      }
      for(var n=0;n<nodes.length;n++){ var nd=nodes[n];
        nd.vx+=(VW/2-nd.x)*0.004; nd.vy+=(VH/2-nd.y)*0.004;
        nd.vx*=0.82; nd.vy*=0.82;
        nd.x+=Math.max(-22,Math.min(22,nd.vx)); nd.y+=Math.max(-22,Math.min(22,nd.vy));
      }
    }
  }

  function paint(){
    var frag=document.createDocumentFragment();
    edges.forEach(function(ed){
      var l=document.createElementNS(SVGNS,'line');
      l.setAttribute('stroke',EDGE); l.setAttribute('stroke-width','1.2'); l.setAttribute('stroke-linecap','round');
      ed.el=l; frag.appendChild(l);
    });
    nodes.forEach(function(nd){
      var c=document.createElementNS(SVGNS,'circle');
      c.setAttribute('r', String(5+Math.min(11,nd.deg*1.4)));
      c.setAttribute('fill', nd.dep?'#9aa0a6':color(nd.root));
      c.setAttribute('opacity', nd.dep?'0.4':'0.92');
      c.setAttribute('stroke',BG); c.setAttribute('stroke-width','2');
      c.style.cursor='pointer'; c.__n=nd; nd.el=c; frag.appendChild(c);
    });
    view.appendChild(frag);
    position();
  }
  function position(){
    edges.forEach(function(ed){ ed.el.setAttribute('x1',ed.s.x);ed.el.setAttribute('y1',ed.s.y);ed.el.setAttribute('x2',ed.t.x);ed.el.setAttribute('y2',ed.t.y); });
    nodes.forEach(function(nd){ nd.el.setAttribute('cx',nd.x);nd.el.setAttribute('cy',nd.y); });
  }

  // Frame the graph: set viewBox to the node bounding box + padding. SVG scales
  // this to the element automatically (preserveAspectRatio), so it always fills.
  function fit(){
    var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
    nodes.forEach(function(n){ minx=Math.min(minx,n.x); miny=Math.min(miny,n.y); maxx=Math.max(maxx,n.x); maxy=Math.max(maxy,n.y); });
    var pad=Math.max(50,(maxx-minx)*0.06);
    vb={x:minx-pad, y:miny-pad, w:Math.max(50,(maxx-minx)+pad*2), h:Math.max(50,(maxy-miny)+pad*2)};
    applyVB();
  }

  function wire(){
    var drag=null, pan=null;
    svg.addEventListener('mousedown',function(ev){
      if(ev.target&&ev.target.__n){ drag=ev.target.__n; }
      else { pan={cx:ev.clientX,cy:ev.clientY,x:vb.x,y:vb.y}; }
      svg.classList.add('pan');
    });
    window.addEventListener('mousemove',function(ev){
      if(drag){ var u=clientToUser(ev.clientX,ev.clientY); drag.x=u.x; drag.y=u.y; position(); }
      else if(pan){ var r=svg.getBoundingClientRect(); vb.x=pan.x-(ev.clientX-pan.cx)*(vb.w/r.width); vb.y=pan.y-(ev.clientY-pan.cy)*(vb.h/r.height); applyVB(); }
    });
    window.addEventListener('mouseup',function(){ drag=null; pan=null; svg.classList.remove('pan'); });
    svg.addEventListener('wheel',function(ev){
      ev.preventDefault();
      var u=clientToUser(ev.clientX,ev.clientY), f=ev.deltaY<0?0.88:1.14;
      vb.x=u.x-(u.x-vb.x)*f; vb.y=u.y-(u.y-vb.y)*f; vb.w*=f; vb.h*=f; applyVB();
    },{passive:false});

    var adj={}; nodes.forEach(function(n){adj[n.id]={}});
    edges.forEach(function(ed){ adj[ed.s.id][ed.t.id]=1; adj[ed.t.id][ed.s.id]=1; });
    nodes.forEach(function(nd){
      nd.el.addEventListener('mouseenter',function(ev){
        tip.innerHTML='<b>'+esc(nd.title)+'</b><span class="m">'+esc(nd.local)+' · '+esc(nd.store)+' · '+esc(nd.scope)+(nd.dep?' · 已弃用':'')+' · '+nd.deg+' 关联</span>';
        tip.style.opacity='1'; moveTip(ev);
        nodes.forEach(function(o){ o.el.setAttribute('opacity', (o===nd||adj[nd.id][o.id])?'1':'0.12'); });
        edges.forEach(function(ed){ var on=(ed.s===nd||ed.t===nd); ed.el.setAttribute('stroke', on?color(nd.root):EDGE); ed.el.setAttribute('stroke-width', on?'2.4':'0.6'); ed.el.setAttribute('opacity', on?'0.9':'0.15'); });
      });
      nd.el.addEventListener('mousemove',moveTip);
      nd.el.addEventListener('mouseleave',function(){
        tip.style.opacity='0';
        nodes.forEach(function(o){ o.el.setAttribute('opacity', o.dep?'0.4':'0.92'); });
        edges.forEach(function(ed){ ed.el.setAttribute('stroke',EDGE); ed.el.setAttribute('stroke-width','1.2'); ed.el.setAttribute('opacity','1'); });
      });
    });
    function moveTip(ev){ tip.style.left=Math.min(ev.clientX+14,window.innerWidth-350)+'px'; tip.style.top=(ev.clientY+14)+'px'; }
  }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':'&quot;'}); }
})();
</script>
</body></html>`;
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
        // /graph — the relationship graph module (self-contained view). It reads
        // /api/knowledge?all= client-side, so no server data is inlined here.
        if (pathname === "/graph") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(renderGraphView());
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
