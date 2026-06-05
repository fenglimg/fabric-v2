# Fabric 知识层 × 全生命周期职责设计 — v5（应用 Round5 边界闭合）

> v5 = v4（架构 + 7 落地修正，round3/4 收敛）+ Round5 两路冷评的「最后一公里」边界闭合。
> Round5 两路(codex/gemini)均预告「补完即 PASS / 进入编码阶段」——本版即补完项。

## v4 全部保留（不复述，见 `lifecycle-concept-v4.md`）
R4-1 cite 拆 explicit/exposed_and_mutated · R4-2 events 物理双轴 · R4-3 join 下沉 doctor · R4-4 泄露护栏下沉 skill · R4-5 图谱二阶消费 · R4-6 store 归因主键 · R4-7 git diff 兜底 · R4-8 全景按需展开。

---

## Round5 三补（v5 delta）

### R5-1 物理隔离贯彻到**所有 keyed 数据面**（cache + 图谱边）——两路共识
R4-2 只拆了 events,但 R4-3 的 flat counter / R4-5 的图谱边仍可能让 personal 指纹落项目目录。**补完**：

- **flat counter 双轨**（gemini）：涉 `team:*` 计数 → 项目级 `./.fabric/.cache/session_${id}_team.json`；涉 `personal:*` → 全局级 `~/.fabric/.cache/session_${id}_personal.json`；doctor 按同 `session_id` 合并两轨。
- **keyed telemetry 同分区铁律**（codex）：所有携带 `store_id`/`stable_id`/`source_event_id`/content-hash 的 telemetry artifact，必须与 events **同物理分区**——team-only 写项目 `.fabric/`，personal-only 写 `~/.fabric/`。项目级 cache **只允许 id-free aggregate counters**；doctor 可在本地进程内合并 team+personal，但**绝不把 personal keyed telemetry 写回项目目录**。
- **图谱边方向约束**（gemini，拓扑泄漏）：**禁止 `Team → Personal` 的 `related` 边**（否则 KT metadata 随项目 git 提交时硬编码 KP id = 拓扑指纹泄漏）。允许 `Personal → Team`（personal 数据留本地，含 team id 安全）。doctor 补边 / archive skill 生成边时，检测到 `Team→Personal` 意图**强行丢弃**。

### R5-2 git diff 兜底的归因降级（codex）
R4-7 的 `git diff --name-only` 只证"工作区有变更"≠"本 session/tool 成功 mutation",会误计他人 CLI / 用户手改 / 预先 dirty 文件。**补完**：
- `git diff --name-only` 仅作 doctor 的 **low-confidence `mutation_pool`**，**默认不计入 `exposed_and_mutated` / store attribution**。
- 仅当**同时**满足：① 存在同 session 的成功 shell-like tool event；② 存在 clean/prestate baseline，或 doctor 可证该 path 在 session window 内**首次**变 dirty；③ 能绑定唯一 `source_event_id`——才提升为 `file_mutated(fallback)`。
- 否则仅分列展示为 `unattributed_workspace_dirty`，不污染真实指标。

### R5-3 实现注记（gemini 标的非 block 实现期项，吸收）
- **hook 双路复用写**：R4-2 双账本意味着 SessionStart/PreToolUse/Stop 不再无脑 append 单文件，需按 `store:` 前缀在内存拆包，动态决定写 `~/.fabric/` 还是 `./.fabric/`（维护两个 advisory-lock 路径，仍 O(1)）。
- **panorama 预编译**：R4-8 的 `.cache/panorama.json` 必须由 doctor/server 在知识库增删改时**异步预生成**；hook 层绝不在 SessionStart 现算。

---

## 隐私物理隔离总图（v5 完整闭合）

| 数据面 | team(`KT-*`) | personal(`KP-*`) |
|---|---|---|
| events 总账 | `./.fabric/events.jsonl`(随 git) | `~/.fabric/events.jsonl`(本地) |
| flat counter | `./.fabric/.cache/..._team.json` | `~/.fabric/.cache/..._personal.json` |
| keyed telemetry | 项目级(id-free aggregate 才入项目) | `~/.fabric/`(keyed) |
| 图谱 related 边 | KT→KT / KT→(无 KP) | KP→KP / KP→KT(允许) |
| cite 归因 | `team:KT-*` 主键 | `personal:KP-*` 主键，不写项目账本 |

> **不变量**：项目物理目录(`./.fabric/` 全部，含 .cache)绝不含任何 personal 行为指纹(id / 引用 / 计数 / 拓扑边)。doctor 是唯一能跨轨合并的进程，且合并态留内存/本地，不回写项目。

## 本版核心主张
> v4 治好了"统计注水"和"前台阻塞"；v5 把**物理隔离从 events 单点贯彻到全数据面(counter / telemetry / 图谱拓扑)**，并把 git diff 兜底降级为可证伪的低置信池。至此「multi-store × 真实有效性」生命周期概念**完全自洽、无泄漏、可观测**——达可签署落地终态。
