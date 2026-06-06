# Fabric 知识层 × 全生命周期职责设计 — v4（应用 Round4 冷评 7 修正）

> Ground truth：`./lifecycle-baseline.md`。v4 = v3 架构（8 hook×3 lifecycle 接点决策，round3 panel 三轮无人推翻）+ Round4 三路冷评的 7 个落地精修。

## 不变（v3 已定，本版不改）
- 元定位：**F-EFF-4 可观测性是地基**（SessionStart 记 surfaced / PostToolUse 记 edited / SessionEnd 对账）。
- 接点裁定：SessionEnd/PostToolUse 激活；UserPromptSubmit/StopFailure/PostToolUseFailure/Todo 保持盲；全景不建可视化地图；图谱边不在 hook 内产。
- 定档层 A 节 frozen（除下方 R4-2 对 multi-store 的**限定**，非推翻）。

---

## Round4 七修正（v4 核心 delta）

### R4-1 cite 指标拆分 —— 杜绝"统计注水"（三家共识，最致命）
v3 的 `cite:applied(inferred) = surfaced×edited 交集` 是**假阳性**：改一行日志没碰规则、甚至本轮已 `[dismissed]` 的规则，都会被强判 applied，把真实 2.5% 遵循度刷成虚假繁荣。**修正**：
- **两个独立字段，绝不并入同一覆盖率**：`cite:applied(explicit)`（人写 `KB:`，=真遵循度，仍诚实显示 2.5%）vs `cite:exposed_and_mutated`（曝光且路径变更，**弱信号、改名去掉"applied"**）。
- `doctor --cite-coverage` **分列展示**，禁止对外给合并后的稀释覆盖率。
- exposed_and_mutated 命中三条件：① 来自 narrow PreToolUse surfaced；② contract glob **特异**（排除 `**/*` / `*` / 无物理约束的 guidelines/processes）；③ 本轮该 stable_id **未被 `[dismissed]`**。

### R4-2 events 物理双轴拆分 —— 根治 personal→team 泄露（agy 重磅）
`events.jsonl` 随项目 git 提交/同步/公开；read-set 含 personal → `personal:KP-*` 的曝光/引用事件会**固化进团队公共账本 = 私有知识指纹泄露**。**修正**（这是定档层"events 单总账"在 multi-store 下的**必要限定**，非推翻——每个物理账本内仍是该 store 的唯一总账）：
- 项目级 `.fabric/events.jsonl` **仅记 team(`KT-*`)** 事件 + 不含个人指纹的公共变更。
- 个人级 `~/.fabric/events.jsonl` 记**所有 `KP-*`** 曝光/显式引用/推断。
- **严禁任何 `personal:` 前缀 id/内容写入项目级总账。**

### R4-3 O(1) join 全下沉 doctor（三家共识，守定档层）
v3 的 "Stop join surfaced×edited" / "SessionEnd funnel 对账" 若在 hook 内跑 glob/聚合 = **破 A 节前台 O(1)**。**修正**：
- SessionStart/PreToolUse/PostToolUse/Stop 只更新 **session-scoped flat counters**（`.cache/session_${id}.json`，纯 O(1) 累加 append）。
- SessionEnd **仅 append `session_ended` marker**（session_id + ts），零计算。
- 所有 join/funnel/命中率/multi-store 分组 = **doctor 后台**从 flat counter + events 重建。**hook 严禁运行时 glob 匹配。**

### R4-4 泄露护栏下沉 skill pre-flight（codex+agy，Paper Tiger 修复）
v3 的 "personal→team 强 warning" **无执行点**：PreToolUse 只 matcher `Edit|Write|MultiEdit`，`fabric-archive` skill 写 store 时根本不触发；Stop 时泄露已落盘。**修正**：
- 泄露检查**硬编码进 `fabric-archive`/`fabric-import` skill 的 pre-flight 拦截器**：personal-only 来源默认写 personal；team cite/公共决策才可写 team；跨 store promotion 需**显式确认**。
- 不寄望 lifecycle hook 防写泄露（结构上拦不住 skill 写入）。

### R4-5 图谱二阶消费闭环（codex+agy，F-EFF-1 真解）
v3 只解决边"生成 telemetry"，**消费端断档** → 图谱仍空转。**修正**，补完整边生命周期：
- **生成**：archive/import skill 内 LLM 抽 `related`（有上下文）+ doctor 后台共现补边；边必须 **store-qualified**。
- **消费（新增）**：SessionStart/PreToolUse 召回时，命中节点**沿 `related` 边追加对端节点**（标 `reason: related-to-{id}`）。边=0 时诚实 no-op + 显示 "graph empty"。
- **维护**：doctor 做边 decay，与节点 decay 同步。

### R4-6 store 归因主键 —— 防多 store 重复计数（codex）
`surfaced×edited` 右侧 edited path **无 store 维度**，team/personal 同 glob 时单 edit 被双计。**修正**：
- 推断主键 = `store_id + stable_id + source_event_id`。
- 同一 edit path 被多 store contract 命中 → **只进候选集合，不同时计多个 store 的 applied**；归属靠 overlay/priority 或显式 cite 决定。

### R4-7 PostToolUse + git diff 兜底（agy）
`PostToolUse` 拦工具参数抓不到 `run_command`（git apply/sed/格式化）的**隐式文件变更** → join 漏判。**修正**：
- doctor 侧（非 hook）以 `git diff --name-only` 作 `file_mutated` 的**兜底校准源**，补齐 PostToolUse 未捕获但实际被改的项目文件。

### R4-8 全景默认 per-store 摘要 + 按需展开（gemini，扩展性）
v3 "22 节点升 k 列全集" 在 200+ 节点冲爆 context。**修正**：
- **默认** = per-store 聚合摘要（type counts / graph density，O(1) 读 `.cache/panorama.json`）。
- 全集 description 仅当节点数 < 阈值（如 30）附加；超阈值降级为类目计数，展开靠显式 `fab_plan_context` / 搜索。

---

## 更新后 8 Hook 决策表（v4）

| 阶段 | 裁定 | v4 关键点 |
|---|---|---|
| SessionStart ✅ | 保留+增强 | 分 store 召回合并 + store 前缀 + **per-store 全景摘要(R4-8)** + 沿 related 边二阶召回(R4-5) + append surfaced flat counter(R4-3) + personal 曝光写个人账本(R4-2) |
| SessionEnd ❌→激活 | **仅 marker** | 只 append `session_ended`(R4-3 修正：零计算，funnel 全下沉 doctor) |
| UserPromptSubmit ❌ | 保持盲 | 不变 |
| Stop ✅ | 保留+增强 | store-qualified cite 收割 + append flat counter(不 join，R4-3) + archive 成功 append edge 候选 + cite 拆 explicit/exposed(R4-1) |
| StopFailure ❌ | 不可接 | 守 B2 |
| PreToolUse ⚠️ | 保留窄 | narrow 标 store + 沿边二阶召回(R4-5) + append surfaced flat counter |
| PostToolUse ❌→激活 | 落 mutation | append `file_mutated`(per-call key) + doctor git diff 兜底(R4-7) + 归因主键(R4-6) |
| PostToolUseFailure ❌ | 不可接 | 守 B2 |

## 净变更（v4 相对 v3）
- cite：拆 explicit/exposed_and_mutated 不混算（不再掩盖 2.5%）
- events：项目级(team)/个人级(personal)物理双轴拆分（防泄露）
- join：全下沉 doctor，hook 只 O(1) flat counter append
- 泄露护栏：下沉 archive/import skill pre-flight（有执行点）
- 图谱：补消费端二阶召回 + doctor decay（闭环）
- 归因：store_id+stable_id+source_event_id 主键防双计
- mutation：git diff 兜底 run_command 隐式改
- 全景：默认 per-store 摘要，按需展开（可扩展）

## 本版核心主张
> 可观测性地基之上，**诚实第一**：cite 真遵循度（2.5%）绝不被弱推断稀释掩盖；个人知识绝不泄露进团队账本（events 物理双轴）；所有"聪明的 join"全下沉 doctor 守住前台 O(1)；图谱从"只生成"补到"二阶消费 + decay"真闭环。知识层从"假装有效"转为"可观测、可信、不泄露"。
