import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  :root{--bg:#f6f6f4;--surface:#fff;--border:#e5e3de;--text:#1f1e1c;--text2:#6b6862;--edge:rgba(120,120,120,.34);}
  @media (prefers-color-scheme:dark){:root{--bg:#161512;--surface:#232220;--border:#383632;--text:#ecebe8;--text2:#a8a49c;--edge:rgba(160,160,160,.26);}}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
  .bar{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:16px;
    padding:0 18px;background:var(--surface);border-bottom:1px solid var(--border);z-index:10}
  .bar h1{font-size:15px;font-weight:600;margin:0;white-space:nowrap}
  .bar .sp{flex:1}
  .bar a,.seg{text-decoration:none;color:var(--text2);font-size:13px;cursor:pointer;padding:5px 10px;border-radius:6px;white-space:nowrap}
  .seg.active{color:var(--text);background:rgba(127,127,127,.16)}
  .legend{display:flex;gap:12px;font-size:12px;color:var(--text2);align-items:center;white-space:nowrap;overflow:hidden}
  .legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:middle}
  #stat{font-size:12px;color:var(--text2);white-space:nowrap}
  svg{position:fixed;top:52px;left:0;width:100vw;height:calc(100vh - 52px);cursor:grab;display:block}
  svg.pan{cursor:grabbing}
  .nodelabel{pointer-events:none;user-select:none}
  .tip{position:fixed;pointer-events:none;z-index:20;max-width:340px;padding:8px 11px;border-radius:8px;
    background:var(--surface);border:1px solid var(--border);box-shadow:0 4px 18px rgba(0,0,0,.2);
    font-size:12px;line-height:1.55;opacity:0;transition:opacity .1s}
  .tip b{display:block;font-size:12px;margin-bottom:3px}
  .tip .m{color:var(--text2)}
  .empty{position:fixed;top:55%;left:0;right:0;text-align:center;color:var(--text2)}
  /* 点击节点/孤点清单的右侧滑出面板 */
  #panel{position:fixed;top:52px;right:0;bottom:0;width:320px;background:var(--surface);
    border-left:1px solid var(--border);transform:translateX(100%);transition:transform .18s ease;
    z-index:15;overflow-y:auto;padding:16px}
  #panel.open{transform:translateX(0)}
  #panel h2{font-size:14px;margin:0 0 8px;line-height:1.5}
  #panel .meta{font-size:12px;color:var(--text2);margin-bottom:10px;line-height:1.7}
  #panel .sum{font-size:12px;line-height:1.7;color:var(--text);background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px}
  #panel .tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px}
  #panel .tag{font-size:11px;border:1px solid var(--border);border-radius:6px;padding:1px 6px;color:var(--text2)}
  #panel a.go{font-size:12px;display:inline-block;margin-top:4px}
  #panel .row{display:block;padding:6px 8px;border-radius:6px;font-size:12px;color:var(--text);text-decoration:none;line-height:1.5}
  #panel .row:hover{background:rgba(127,127,127,.12)}
  #panel .row .m{color:var(--text2);font-size:11px;display:block}
  #panel .close{float:right;cursor:pointer;color:var(--text2);font-size:14px;padding:2px 6px}
</style></head><body>
<div class="bar">
  <h1>知识关联图</h1>
  <span class="legend" id="legend"></span>
  <span id="stat"></span>
  <span class="sp"></span>
  <span class="seg" id="orphanBtn"></span>
  <span class="seg" id="sProj">本项目</span><span class="seg" id="sAll">全部</span>
  <a href="/">← 返回列表</a>
</div>
<svg id="g"><g id="view"></g></svg><div class="tip" id="tip"></div>
<aside id="panel"></aside>
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
  var panel=document.getElementById('panel');
  function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}
  // 按 store 分簇着色:store 名稳定哈希取 6 色环(弃用统一灰),图例按实际 store 动态生成
  var STORE_COLORS=['#0d9488','#2563eb','#7c3aed','#ea580c','#db2777','#65a30d'];
  var storeColorCache={};
  function storeColor(store){
    if(storeColorCache[store])return storeColorCache[store];
    var h=0; for(var i=0;i<store.length;i++){ h=(h*31+store.charCodeAt(i))>>>0; }
    var c=STORE_COLORS[h%STORE_COLORS.length];
    // 撞色时线性探测,尽量让不同 store 拿不同色
    var used={}; for(var k in storeColorCache) used[storeColorCache[k]]=1;
    for(var j=0;j<STORE_COLORS.length&&used[c];j++){ c=STORE_COLORS[(h+j)%STORE_COLORS.length]; }
    storeColorCache[store]=c; return c;
  }
  var EDGE=cssVar('--edge'), BG=cssVar('--bg'), TEXT2=cssVar('--text2');
  var VW=1400, VH=900, vb={x:0,y:0,w:VW,h:VH};
  function applyVB(){ svg.setAttribute('viewBox', vb.x+' '+vb.y+' '+vb.w+' '+vb.h); }
  function clientToUser(cx,cy){ var pt=svg.createSVGPoint(); pt.x=cx; pt.y=cy; var m=svg.getScreenCTM(); return m?pt.matrixTransform(m.inverse()):{x:cx,y:cy}; }
  function truncate14(s){ s=String(s||''); return s.length>14?s.slice(0,14)+'…':s; }

  fetch('/api/knowledge?all='+(all?'1':'0'),{cache:'no-store'})
    .then(function(r){return r.json()})
    .then(function(d){ build(d.entries||[]); })
    .catch(function(e){ document.body.insertAdjacentHTML('beforeend','<div class="empty">加载失败: '+e.message+'</div>'); });

  var nodes=[], edges=[], conn=[], orphans=[];
  function build(entries){
    nodes=entries.map(function(e,i){
      var ang=i*2.399963, rad=Math.min(VW,VH)*0.44*Math.sqrt((i+1)/entries.length);
      return {id:e.qualifiedId, local:e.id, title:e.title||e.id, summary:e.summary||'', tags:e.tags||[],
        maturity:e.maturity||'', store:e.store, scope:e.scope||'team',
        dep:!!e.deprecated, deg:0, x:VW/2+Math.cos(ang)*rad, y:VH/2+Math.sin(ang)*rad, vx:0, vy:0};
    });
    // 边源:frontmatter related,仅同 store 解析(KT→KP 隐私铁律)。不引入新边源。
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
    // 有边子图为主画面;孤点折叠进清单(不静默隐藏,KT-DEC-0028 完整性)
    conn=nodes.filter(function(n){return n.deg>0;});
    orphans=nodes.filter(function(n){return n.deg===0;});
    document.getElementById('stat').textContent=nodes.length+' 条 · '+edges.length+' 关联';
    document.getElementById('orphanBtn').textContent='未关联条目 '+orphans.length+' 条';
    // 图例:实际出现的 store + 弃用
    var stores=[]; conn.forEach(function(n){ if(stores.indexOf(n.store)===-1) stores.push(n.store); });
    var lg=document.getElementById('legend');
    lg.innerHTML=stores.map(function(st){
      return '<span><i style="background:'+storeColor(st)+'"></i>'+esc(st)+'</span>';
    }).join('')+'<span style="opacity:.5"><i style="background:#9aa"></i>已弃用</span>';
    if(!nodes.length){ document.body.insertAdjacentHTML('beforeend','<div class="empty">该视角下暂无知识条目</div>'); return; }
    if(!conn.length){ document.body.insertAdjacentHTML('beforeend','<div class="empty">暂无 related 关联边 — 打开「未关联条目」清单浏览全部条目</div>'); }
    simulate(); paint(); fit(); wire();
  }

  function simulate(){
    if(!conn.length) return;
    var k=Math.min(VW,VH)/Math.sqrt(conn.length)*0.9;
    for(var it=0; it<300; it++){
      for(var a=0;a<conn.length;a++){ var na=conn[a];
        for(var b=a+1;b<conn.length;b++){ var nb=conn[b];
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
      for(var n=0;n<conn.length;n++){ var nd=conn[n];
        nd.vx+=(VW/2-nd.x)*0.004; nd.vy+=(VH/2-nd.y)*0.004;
        nd.vx*=0.82; nd.vy*=0.82;
        nd.x+=Math.max(-22,Math.min(22,nd.vx)); nd.y+=Math.max(-22,Math.min(22,nd.vy));
      }
    }
  }

  function nodeR(nd){ return 5+Math.min(11,nd.deg*1.4); }
  function paint(){
    var frag=document.createDocumentFragment();
    edges.forEach(function(ed){
      var l=document.createElementNS(SVGNS,'line');
      l.setAttribute('stroke',EDGE); l.setAttribute('stroke-width','1.2'); l.setAttribute('stroke-linecap','round');
      ed.el=l; frag.appendChild(l);
    });
    conn.forEach(function(nd){
      var c=document.createElementNS(SVGNS,'circle');
      c.setAttribute('r', String(nodeR(nd)));
      c.setAttribute('fill', nd.dep?'#9aa0a6':storeColor(nd.store));
      c.setAttribute('opacity', nd.dep?'0.4':'0.92');
      c.setAttribute('stroke',BG); c.setAttribute('stroke-width','2');
      c.style.cursor='pointer'; c.__n=nd; nd.el=c; frag.appendChild(c);
      // 常驻短标签:标题截 14 字,置于节点下方
      var t=document.createElementNS(SVGNS,'text');
      t.setAttribute('class','nodelabel'); t.setAttribute('text-anchor','middle');
      t.setAttribute('font-size','10'); t.setAttribute('fill',TEXT2);
      t.textContent=truncate14(nd.title);
      nd.label=t; frag.appendChild(t);
    });
    view.appendChild(frag);
    position();
  }
  function position(){
    edges.forEach(function(ed){ ed.el.setAttribute('x1',ed.s.x);ed.el.setAttribute('y1',ed.s.y);ed.el.setAttribute('x2',ed.t.x);ed.el.setAttribute('y2',ed.t.y); });
    conn.forEach(function(nd){
      nd.el.setAttribute('cx',nd.x); nd.el.setAttribute('cy',nd.y);
      nd.label.setAttribute('x',nd.x); nd.label.setAttribute('y',nd.y+nodeR(nd)+11);
    });
  }

  function fit(){
    if(!conn.length) return;
    var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
    conn.forEach(function(n){ minx=Math.min(minx,n.x); miny=Math.min(miny,n.y); maxx=Math.max(maxx,n.x); maxy=Math.max(maxy,n.y); });
    var pad=Math.max(50,(maxx-minx)*0.08);
    vb={x:minx-pad, y:miny-pad, w:Math.max(50,(maxx-minx)+pad*2), h:Math.max(50,(maxy-miny)+pad*2)};
    applyVB();
  }

  var adj={}, locked=null;
  function highlight(nd){
    conn.forEach(function(o){ o.el.setAttribute('opacity', (o===nd||adj[nd.id][o.id])?'1':'0.12'); o.label.setAttribute('opacity',(o===nd||adj[nd.id][o.id])?'1':'0.15'); });
    edges.forEach(function(ed){ var on=(ed.s===nd||ed.t===nd); ed.el.setAttribute('stroke', on?storeColor(nd.store):EDGE); ed.el.setAttribute('stroke-width', on?'2.4':'0.6'); ed.el.setAttribute('opacity', on?'0.9':'0.15'); });
  }
  function clearHighlight(){
    conn.forEach(function(o){ o.el.setAttribute('opacity', o.dep?'0.4':'0.92'); o.label.setAttribute('opacity','1'); });
    edges.forEach(function(ed){ ed.el.setAttribute('stroke',EDGE); ed.el.setAttribute('stroke-width','1.2'); ed.el.setAttribute('opacity','1'); });
  }
  function showPanel(nd){
    var html='<span class="close" id="pclose">✕</span>';
    html+='<h2>'+esc(nd.title)+(nd.dep?' <span style="font-size:11px;color:var(--text2)">已弃用</span>':'')+'</h2>';
    html+='<div class="meta">'+esc(nd.local)+' · '+esc(nd.store)+'<br>'+esc(nd.scope)+(nd.maturity?' · 成熟度 '+esc(nd.maturity):'')+' · '+nd.deg+' 条关联</div>';
    if(nd.summary) html+='<div class="sum">'+esc(nd.summary)+'</div>';
    if(nd.tags.length) html+='<div class="tags">'+nd.tags.map(function(tg){return '<span class="tag">#'+esc(tg)+'</span>';}).join('')+'</div>';
    html+='<a class="go" href="/?entry='+encodeURIComponent(nd.id)+'">查看详情 →</a>';
    panel.innerHTML=html; panel.classList.add('open');
    document.getElementById('pclose').onclick=closePanel;
  }
  function showOrphans(){
    var html='<span class="close" id="pclose">✕</span><h2>未关联条目 '+orphans.length+' 条</h2>';
    html+='<div class="meta">这些条目还没有 related 关联边 — 用 fabric-connect 建边后会进入图中。</div>';
    html+=orphans.map(function(n){
      return '<a class="row" href="/?entry='+encodeURIComponent(n.id)+'">'+esc(truncate14(n.title))+'<span class="m">'+esc(n.local)+' · '+esc(n.store)+'</span></a>';
    }).join('');
    panel.innerHTML=html; panel.classList.add('open');
    document.getElementById('pclose').onclick=closePanel;
  }
  function closePanel(){ panel.classList.remove('open'); locked=null; clearHighlight(); }
  document.getElementById('orphanBtn').onclick=showOrphans;

  function wire(){
    var drag=null, pan=null, moved=false;
    svg.addEventListener('mousedown',function(ev){
      moved=false;
      if(ev.target&&ev.target.__n){ drag=ev.target.__n; }
      else { pan={cx:ev.clientX,cy:ev.clientY,x:vb.x,y:vb.y}; }
      svg.classList.add('pan');
    });
    window.addEventListener('mousemove',function(ev){
      if(drag){ moved=true; var u=clientToUser(ev.clientX,ev.clientY); drag.x=u.x; drag.y=u.y; position(); }
      else if(pan){ moved=true; var r=svg.getBoundingClientRect(); vb.x=pan.x-(ev.clientX-pan.cx)*(vb.w/r.width); vb.y=pan.y-(ev.clientY-pan.cy)*(vb.h/r.height); applyVB(); }
    });
    window.addEventListener('mouseup',function(){ drag=null; pan=null; svg.classList.remove('pan'); });
    svg.addEventListener('wheel',function(ev){
      ev.preventDefault();
      var u=clientToUser(ev.clientX,ev.clientY), f=ev.deltaY<0?0.88:1.14;
      vb.x=u.x-(u.x-vb.x)*f; vb.y=u.y-(u.y-vb.y)*f; vb.w*=f; vb.h*=f; applyVB();
    },{passive:false});
    // 点空白解除锁定;点节点锁定高亮 + 滑出条目卡片
    svg.addEventListener('click',function(ev){
      if(moved) return;
      if(ev.target&&ev.target.__n){ locked=ev.target.__n; highlight(locked); showPanel(locked); }
      else closePanel();
    });

    conn.forEach(function(n){adj[n.id]={}});
    edges.forEach(function(ed){ adj[ed.s.id][ed.t.id]=1; adj[ed.t.id][ed.s.id]=1; });
    conn.forEach(function(nd){
      nd.el.addEventListener('mouseenter',function(ev){
        tip.innerHTML='<b>'+esc(nd.title)+'</b><span class="m">'+esc(nd.local)+' · '+esc(nd.store)+' · '+esc(nd.scope)+(nd.dep?' · 已弃用':'')+' · '+nd.deg+' 关联</span>';
        tip.style.opacity='1'; moveTip(ev);
        if(!locked) highlight(nd);
      });
      nd.el.addEventListener('mousemove',moveTip);
      nd.el.addEventListener('mouseleave',function(){
        tip.style.opacity='0';
        if(!locked) clearHighlight(); else highlight(locked);
      });
    });
    function moveTip(ev){ tip.style.left=Math.min(ev.clientX+14,window.innerWidth-350)+'px'; tip.style.top=(ev.clientY+14)+'px'; }
  }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':'&quot;'}); }
})();
</script>
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
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(renderGraphView());
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
    all: {
      type: "boolean",
      description: t("cli.preview.arg.all"),
      default: false,
    },
  },
  async run({
    args,
  }: {
    args: { port?: string; host?: string; open?: boolean; target?: string; all?: boolean };
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
