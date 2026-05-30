# V2.2 M2 — 同空间产品 MCP 知识工具层设计对比

研究目标: 提炼工具粒度 / one-shot 打包 / 引导 AI 调用三个维度的可借鉴模式, 供 Fabric MCP 工具面 (fab_recall / fab_plan_context / fab_get_knowledge_sections) 借鉴。
边界: provenance/contention 工具仅记录存在, 不深入吸收 (归 v2.1 全局化 northstar D7)。不碰检索打分算法。

---

## 1. valence — 多而细, 命名空间分域 (34 tools)

源: `/Users/wepie/Desktop/personal-projects/valence/src/valence/mcp/tools.py` (34 个 `Tool(` 定义), handler 分文件 `src/valence/mcp/handlers/{memory,articles,sources,sessions,provenance,contention,admin}.py`。

### 粒度策略: 粗放, 按域命名空间前缀切
工具用 `<domain>_<verb>` 命名, 7 个域:
- source_* (ingest/get/search/list) — 原始素材
- knowledge_search — 统一检索入口 (tools.py:164)
- article_* (get/create/compile/update/split/merge/search) — 编译后的文章
- provenance_* (trace/get/link) — tools.py:409/432/446 (**northstar D7 边界, 仅记录**)
- contention_* (list/resolve/detect) — tools.py:472/494/524 (**northstar D7 边界, 对标 cite contract 冲突治理, 仅记录**)
- admin_* (forget/stats/maintenance)
- memory_* (store/recall/status/forget) + session_* (start/append/flush/finalize/search/list/get/compile/flush_stale)

读/写/治理分层清晰: 读=*_search/*_get; 写=*_create/*_store/*_update; 治理=provenance_*/contention_*/admin_*。
代价: 34 个工具占大量 tool-list token, 小模型易迷失。

### one-shot: 弱。memory_recall 是 knowledge_search 的 agent-friendly wrapper
- `memory_recall` (tools.py:668, handler memory.py:107) 内部调 `knowledge_search` + 后过滤, over-fetch `limit * RECALL_OVERFETCH_MULTIPLIER` 再截到 limit (memory.py:136,220)。
- 返回量控制: `SNIPPET_TRUNCATE_LENGTH = 200` (memory.py:27), `content_preview` 截 200 字符 + "..." (memory.py:411-426)。
- 默认 limit=5 (recall) / 10 (knowledge_search), clamp max 50/200。
- **但仍是 search→read 两步**: knowledge_search 返 article 列表, 拿正文要再 article_get(include_provenance) (tools.py:207)。无单工具拿全 body。

### 引导: 靠 tool description 内嵌祈使句 + 排序公式
- description 写死行为指令: knowledge_search 写 `"CRITICAL: Call this BEFORE answering questions..."`, 并公开排序公式 `relevance × 0.5 + confidence × 0.35 + freshness × 0.15` (tools.py:164-)。
- 无 server 级 instructions prompt (server.py:60 `Server("valence")` 仅名字), 无 guidance 工具。引导全压在 per-tool description 上。

---

## 2. OpenAkashic — 一次往返 one-shot 标杆 + server 级长引导 (~32 tools)

源: `/Users/wepie/Desktop/personal-projects/OpenAkashic/closed-web/server/app/mcp_server.py` (3206 行, FastMCP)。manifest `mcp/server.json` 列 32 工具。HTTP 检索核心 `api/app/retrieval.py:203 query_memory`。

### 粒度: 中等偏细, 但显式提供 "minimal toolset" 子集
~32 工具 (search_akashic/get_capsule/search_notes/search_and_read_top/read_note/upsert_note/append_note_section/review_note/...)。
亮点: server instructions 里专门给 **"Small-Model / Low-Context Profile"** 一个 9 工具最小集, 并明说 `"Ignore list_notes / list_folders / debug_* unless explicitly required — they return long payloads."` (mcp_server.py:326-) — 把"工具太多"问题用引导层而非删工具解。

### one-shot: search_and_read_top = fab_recall 直接对标 ★核心实证
`search_and_read_top` (mcp_server.py:492)。docstring 自述 `"One-shot search + read for small/low-context agents. Saves a round-trip compared to search → read_note."`
机制 (mcp_server.py:506-541):
1. 内部跑 search_notes → 取最高分 readable hit → 直接 get_closed_note_by_slug 拿 body, 单次返回。
2. **返回字段按重要性排序** (注释 mcp_server.py:521 明说 bench runner 把 receipt 截到 1500 字, 故把行动指令+正文放最前):
   - `directive` 第一: `"노트 본문의 사실을 인용해 질문에 직접 답하세요. 경로 나열·도구명 반복 금지. 부족하면 read_note 추가 호출."` (引用正文答题, 别复读路径/工具名, 不够再调 read_note)
   - `note_body_preview`: body **截 1200 字符** (mcp_server.py:528) — 显式控返回量
   - 再 retrieval_value / top / other_results / hints / note 全文
3. `include_body` (默认 true)、`include_related` (depth-1 邻居, 默认 false) 让 AI 按需扩缩返回量。
4. 命中空时记 gap, 返回 gap_info 提示去 upsert_note 补 (mcp_server.py:518)。

read_note 也回带 `_next` hint (mcp_server.py:580) 串下一步。HTTP 侧 query_memory 支持 mode=compact/standard/full + fields 投影 + RRF 合并 (retrieval.py:150)。

### 引导: server-level instructions 长 prompt + 活体 tool manifest ★最强
两层引导, 都是 Fabric 没有的:
1. **server instructions** (mcp_server.py:265-373, FastMCP `instructions=`): ~110 行结构化 prompt, 含 "The loop: search before work → write after work → publish", Knowledge Layers, Tool Selection Guide (标 "START HERE"), Recommended Workflow 6 步, Small-Model Profile, Note Path Rules。session 一启动就注入, AI 不靠猜。
2. **_TOOL_MANIFEST 活体清单** (mcp_server.py:111-): 每工具列 `required` / `optional` / `one_of_required` / `do_not_use` / `failure_hint`。注释自述 `"agents use this to avoid hallucinating tools/args"`。failure_hint 是行为型微指令, 如 search_and_read_top 的 `"body가 필요하면 이 도구 하나로 끝. 2회 round-trip 피하기 위해 read_note보다 우선."` (要正文就用这一个, 优先于 read_note 避免两次往返)。
3. 工具改名兼容: 老名 check_contribution_status → claim_contribution_status, description 内置 `failure_hint` 教 AI 自纠 (mcp_server.py:82,150)。

---

## 3. lokb — 少而粗, CLI-first 纯函数复用 (5 tools)

源: `/Users/wepie/Desktop/personal-projects/lokb/crates/lokb-tools/src/lib.rs` (available_tools() 返 5 个), MCP 薄壳 `crates/lokb-serve/src/mcp.rs` (176 行)。

### 粒度: 极简 5 工具, 读为主无写/治理工具
search / read / entity / sources / status (lib.rs:240-296)。无任何 write 或治理工具走 MCP — 写操作留在 CLI (`lokb serve --mcp` vs CLI 命令分流, CLAUDE.md:82,105)。
核心哲学 (lib.rs:1-3 注释): `"Shared tool functions for CLI, MCP Server, and HTTP API. Each tool is a pure function: typed input → typed output."` — 同一组纯函数同时喂 CLI / MCP / HTTP 三个 surface, 零重复。MCP 层 (mcp.rs) 只是 JSON-RPC over stdio 的薄翻译, handle_request 直接转发到 lokb_tools。

### one-shot: 无打包, search/read 两步分离
search (lib.rs:243) 返候选, read (lib.rs:258) 按 source+doc_id 取正文。无单工具拿 body。控量靠 search 的 `limit` (default 20) + source/personal_only/public_only 过滤 (lib.rs:243-256)。

### 引导: 极简 description, 引导外置到 .claude/skills
tool description 一句话 (`"Search the knowledge base using full-text search"`)。引导不在 MCP 层, 而靠外部 `.claude/skills/{review-pr,solve-issue,fix-review-comments}/SKILL.md` 编排串 (与 Fabric 的 skill 编排同构)。CLI-first 产品把 MCP 当瘦适配器, 重逻辑/引导留 CLI + skill。

---

## 4. 可借鉴模式三维度 (标 mcp-infra pain_target)

### A. one-shot 打包 [pain_target: mcp-infra-oneshot] ★最高 ROI
- **search_and_read_top 直接验证 fab_recall 的设计正确性**: 单工具 = search + 取 top + 内联 body, 省一次往返。Fabric rc.37 默认单步 fab_recall(paths=[...]) 一次拿正文, 正是此模式, 同空间已有 production 实证支撑。
- **可吸收的增量** (Fabric 当前缺):
  1. **返回字段按重要性排序 + 首字段放 directive 行动指令** (OpenAkashic mcp_server.py:521-528): 因 client/bench 常截断 receipt, 把"怎么用这些 KB"指令 + 正文放最前, 路径/元数据放后。Fabric fab_recall 返回可加首行 directive。
  2. **body 显式截断阈值** (note_body_preview[:1200], valence content_preview[:200]): Fabric 单步 recall 正文过载正是两步 fallback 的触发因, 可加 per-section preview 截断 + "正文太长? 走 fab_get_knowledge_sections" 的 _next hint。
  3. **include_related depth-1 邻居 + include_body 开关**: 让 AI 按需扩缩返回量, 而非 server 端算法裁 (契合 MEMORY no-server-side-filter)。
  4. **gap 信号**: recall 命中空时返回"该写一条"提示 → 串到 fabric-archive。

### B. 引导 AI 调用 [pain_target: mcp-infra-guidance] ★Fabric 全缺
- **server-level instructions 长 prompt** (OpenAkashic mcp_server.py:265): FastMCP `instructions=` 在 session 启动注入工作流 (search before → write after)、Tool Selection Guide、Recommended Workflow N 步、Small-Model Profile。Fabric MCP server 当前无等价物 (valence server.py:60 也缺), 引导全靠 .fabric/AGENTS.md 三端 block。可把 cite policy / recall-first 律下沉到 MCP instructions, 不依赖 client 注入 AGENTS.md。
- **活体 _TOOL_MANIFEST** (OpenAkashic mcp_server.py:111): per-tool 的 required/optional/`do_not_use`/`failure_hint`。failure_hint 是行为型自纠微指令。Fabric 可给 fab_recall/fab_plan_context 加 do_not_use (如"别手编 selection_token") + failure_hint ("命中空? 调 fab_extract_knowledge 反查 id")。
- **对比**: lokb 引导外置到 skill, valence 内嵌 description 祈使句, OpenAkashic 两层 (server prompt + manifest) 最厚。Fabric 已有 skill 编排 (= lokb 路线), 缺的是 OpenAkashic 的 server-prompt 层。

### C. 工具粒度 [pain_target: mcp-infra-granularity]
- **谱系**: lokb 5 (少而粗, 纯函数复用 CLI/MCP/HTTP) ↔ OpenAkashic ~32 (中, 但给 minimal-toolset 子集) ↔ valence 34 (多而细, 域命名空间)。
- **可借鉴**: 工具多不必删, 用 **引导层给"最小工具集"画像** (OpenAkashic Small-Model Profile + "Ignore *_debug they return long payloads") 化解 tool-list 膨胀。Fabric 3 工具已极简 (lokb 路线), 粒度无痛点, 不需扩。
- **纯函数三 surface 复用** (lokb lib.rs:1-3): 若 Fabric 后续要 CLI/MCP/HTTP 多入口, 此模式 (一组 typed pure fn 喂多 surface) 值得参考, 但当前非 pain。

---

## 5. 触 northstar 边界需 defer 的项

- **provenance_* / contention_*** (valence tools.py:409-524) + OpenAkashic 的 store-qualified / visibility-aware (instructions Visibility & Ownership 段): provenance/store 边界/cite-contract 冲突治理 → 全归 **v2.1 全局化 northstar D7** (物理 store 边界对 AI 可见化 / store-qualified cite / MCP provenance)。本会话仅记录存在, 不吸收设计。
- **检索打分算法** (valence relevance×0.5+conf×0.35+fresh×0.15; OpenAkashic RRF retrieval.py:150; lokb FTS): 明确不碰, 契合 MEMORY no-server-side-kb-filter (LLM 决定, server 不打分裁剪)。
- **review/publish/endorsement 工作流** (OpenAkashic review_note/request_note_publication/confirm_note; valence contention): 部分触 v2.1 C4 endorsement 候选, 非 M2 工具面范畴, defer。

聚焦本会话只吸收: A one-shot 打包增量 + B server-prompt/manifest 引导层 (Fabric 全缺, 最高价值)。
