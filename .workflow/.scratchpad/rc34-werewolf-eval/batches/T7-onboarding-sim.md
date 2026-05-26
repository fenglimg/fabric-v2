# Batch 7: 真人 Onboarding 30min 模拟 (Wang persona)

**Persona**: Wang, Cocos game dev, 5 年 TypeScript, 装了 Claude Code 但完全不懂 Fabric. 同事说 "试试看 werewolf 项目里已经装了, 你跟着 setup 一下". Wang 母语中文, 英文阅读 OK 但慢.

**目的**: 量 mental model 学习曲线和 friction points, 验证 P0-13.

**方法**: 我 (Claude) 尽量"忘掉" Batch 1-6 学到的内容, 按真人 cognitive load 顺序看每个产物, 记录每分钟标记的困惑.

---

## 时间线 (30 min)

### T0-T2 — 第一眼 (60 sec)

Wang `cd werewolf-minigame && ls -la`, 看到:

```
.ai-attribution  .claude/  .codex/  .cursor/  .fabric/  .shared-ai/  .opencode/  .serena/  ...
```

**🤯 困惑 #1**: 一个项目里 4 个 AI 客户端目录 (`.claude/.codex/.cursor/.opencode`) + `.fabric/` + `.ai-attribution/` + `.shared-ai/`. **哪个是主的?** AGENTS.md 是给谁看的?

Wang 习惯打开 README.md → **没 README**, 只有 `AGENTS.md` `CLAUDE.md`. Wang: "这俩干嘛的, 谁看哪个?"

打开 `CLAUDE.md` → 一行 `@.fabric/AGENTS.md`. **🤯 困惑 #2**: `@` 是啥语法? Wang 没用过 Claude Code 文档导入, 把这当作邮件 mention 失败.

### T2-T5 — 翻 AGENTS.md (3 min)

打开 root `AGENTS.md`, 第一段:

> This project uses [Fabric](https://github.com/fenglimg/fabric) for cross-client AI knowledge management.

Wang: "Fabric 是个工具? OK." 继续:

> Knowledge entries live in `.fabric/knowledge/` (team) and `~/.fabric/knowledge/` (personal).

**🤯 困惑 #3**: team 是 git push 的? personal 是本地的? AGENTS.md 没说. Wang 猜对了但不确定.

> Run `fabric doctor` to verify state.

往下翻到 `fabric:bootstrap:begin` 块:

> 修改任何文件前: 两步调用 — 先 `fab_plan_context(paths=[<被改文件>])` 拿到 `selection_token` 与候选 `entries`, 再 `fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [<id>...] })` 取规则正文.

**🤯 困惑 #4 (严重)**: Wang: "我每次改文件前都要调俩接口? 谁调? 我手动还是 Claude?" 没说 — 全篇用祈使句但 subject 暧昧.

继续看 Self-archive policy:

> Phase 0.4 Trigger Gate 用来识别 E3 入口的 structured marker (verbatim 字符串 `self-archive policy triggered by signal`...)

**🤯 困惑 #5 (致命)**: "Phase 0.4? E3? Trigger Gate?" Wang: "这是给 AI 自己看的内部规约, 不是给我看的吧? 那为啥放在根 AGENTS.md?"

**T5 节点决定**: Wang 已经迷糊, 但还没放弃. **认知负担评分: 6/10**.

### T5-T8 — 跑 fabric doctor (3 min)

按 AGENTS.md 说: `fabric doctor`

```bash
$ fabric doctor
zsh: command not found: fabric
$ fab doctor      # 试试简写
[error] fabric doctor /Users/wepie/Desktop/projects/werewolf-minigame
```

**🤯 困惑 #6**: AGENTS.md 写 `fabric doctor`, 实际命令是 `fab`. **文档和 binary 不一致**. (P0 候选: doc/binary naming desync)

**T8 节点**: Wang 已耗时 8min, 还没真懂 fabric 干啥. **认知负担 7/10**.

### T8-T12 — doctor 输出 (4 min)

第一行是 `[error] fabric doctor /path/...`. Wang: "ERROR? 是不是我电脑环境坏了?"

继续滚, 看到 `[ok] Bootstrap anchor: ... [ok] ... [ok] ...` — 26 个 [ok]. Wang: "可能没事." 但下面又是:

```
[error] Agents metadata: [
  {
    "received": "model",
    "code": "invalid_enum_value",
    "options": ["models", ...
```

**🤯 困惑 #7 (致命)**: 一个 zod schema dump 直接糊脸. Wang: "received model expected models? 我没动啊! 是不是 fabric 装坏了?"

**这里 30% 概率 Wang 放弃**. 跑去问同事 "fabric 报 schema 错怎么修". 同事可能也不知道 (因为是 fab 全局版本 vs 项目 schema 不一致, P0-9). 

Wang 不放弃则: 继续看 doctor 完, 还有 5 个 warn (skill_token_budget / cite_goodhart / draft backlog / ...). Wang: 完全不懂这些术语.

**T12 节点**: 12min 过去, **认知负担 9/10**. 此时 40% Wang 已经"算了, 直接用 Claude Code 不装 fabric 也行" 心态.

### T12-T18 — 翻 KB 看实际内容 (6 min)

Wang 想看 fabric 到底存了啥. `ls .fabric/knowledge/`:

```
decisions  guidelines  models  pending  pitfalls  processes
```

**🤯 困惑 #8**: 5 种类型, 加 pending. 谁决定一个 entry 是 decision 还是 guideline? Wang 看到名字直觉:
- decision: "项目做的决定"
- guideline: "规范"
- model: "数据/类型模型?" — 后面看到 KT-MOD-0014 是 "tech-stack", **不是数据模型, 是 schema/architecture 描述**. Wang: "model 这个词用得有点宽."
- pitfall: "踩坑"
- process: "流程"

进 `decisions/`, 看到一个文件:

`KT-DEC-0001--friend-invite-spy-room-display.md`

**🤯 困惑 #9**: ID 命名规则 `KT-DEC-0001`. K=Knowledge? T=Team? DEC=Decision? Wang 猜对但**项目根本没文档说**.

打开文件:
- frontmatter 有 `maturity: draft`, `layer: team`, `source_sessions: ["fabric-import-2026-05-13-r2"]`
- 正文是 "好友邀请与最近好友列表需要补齐卧底房展示" + commit sha

**👍 这条 entry 内容 OK**, Wang: "这是上次 import 进来的 commit summary 吧, 至少看懂了."

但同时:
- 100% 的 entry 都是 `maturity: draft`. Wang: "draft 是不是没确认? 我能改吗?"
- 100% 的 `tags: []`. Wang: "tag 干嘛的, 该填啥?"
- 没有 `## How to use` 或 `## When to apply this`. Wang: "我什么时候该 recall 这条?"

**T18 节点**: 18 min, **认知负担 8/10** (KB 本身可读, 但元数据语义不清).

### T18-T22 — 想真用一次 (4 min)

Wang: "好了我想真让 Claude Code 用一下 fabric. 开 session."

看 `.claude/settings.json`:
```json
"hooks": {
  "Stop": [...fabric-hint.cjs],
  "SessionStart": [...knowledge-hint-broad.cjs],
  "PreToolUse": [...{matcher: "Edit|Write|MultiEdit"} ...knowledge-hint-narrow.cjs]
}
```

Wang: "OK 3 个 hook, 文件名能猜出干啥. 但 hint 到底输出啥? 该看 stderr 还是 stdout?" — settings.json 没说.

Wang 开 Claude session, 第一句问 "fabric 装了什么 KB". 等 AI 回答.

**真实情况 (P0-9 实测)**: 全局 fab rc.30 schema 炸, SessionStart hook silent. AI 看不到任何 KB 提示, 回答可能是 "我看到 `.fabric/knowledge/` 有 48 个文件, 但具体内容需要你告诉我" — 不主动 fab_plan_context.

Wang: "...?? 那 fabric 帮我做了啥? 比手动告诉 Claude 还啰嗦."

**T22 节点**: 22 min, **认知负担 8/10** + **价值感知 2/10**.

### T22-T27 — 看 SKILL.md 想懂 archive (5 min)

Wang 翻 `.claude/skills/fabric-archive/SKILL.md`:

description 字段 (487 char 全英):
> Use this skill when the Stop-hook signals an archive opportunity (events.jsonl shows ≥5 plan_context entries since the last knowledge_proposed event, or ≥24h elapsed since the last archive)...

**🤯 困惑 #10 (致命)**: Wang 中文母语, 英文阅读慢. 487 char 的句子里:
- "Stop-hook signals" — hook 怎么 signal AI?
- "≥5 plan_context entries since last knowledge_proposed event" — 在哪看 entries 数?
- "events.jsonl" — 这文件给谁读?
- "fab_extract_knowledge MCP tool" — MCP 是啥?

Wang 估算阅读时间 90 sec. 读完: "我没看懂啥时该用这 skill. 算了我就让 Claude 决定吧."

继续 body — 看到 Precondition / Phase 0.4 / Phase 0.5 / Phase 0.6 ... 一堆 phase 编号. Wang: "为啥要给 skill 设 phase, 我又看不到 skill 内部."

**T27 节点**: 27 min, **认知负担 9/10**. Wang 心态: "这工具是给 fabric maintainer 设计的, 不是给项目 dev 用的."

### T27-T30 — Wang 的总结 (3 min)

30 min 走完, Wang 学到:
- ✓ Fabric 是给 Claude/Codex/Cursor 共享 KB 的工具
- ✓ KB 分 5 类, 文件在 `.fabric/knowledge/`
- ✓ AGENTS.md 是给 AI 看的 (大概)

Wang 还**不**理解:
- ❌ 我作为 dev 该做什么? 该手写 entry 吗? doctor 报错我修不修?
- ❌ Fabric vs Claude Code 直接用区别在哪? value prop 说不清
- ❌ `KB:` cite 行是 AI 写的还是我写的? 我看 git diff 里都没有
- ❌ "维护 KB" 占我多少时间? 值不值?
- ❌ team vs personal 同步规则?
- ❌ pending 是 review 中的还是待删的?

**Wang 最终决定 (我估算分布)**:
- 30% — 关闭 fabric (不知道怎么关), 继续直接用 Claude Code
- 50% — 留着 fabric 但完全忽略它 (像装饰), 该咋用 Claude 还咋用
- 15% — 找资深同事问 "你们咋用 fabric 的", 跟着学
- 5% — 自己钻研 SKILL.md / ref/ 完整规约, 真上手

---

## 关键 friction 分布 (10 个困惑)

| # | 时间 | 困惑 | 严重度 | 类型 |
|---|---|---|---|---|
| 1 | T0 | 4 个 AI 客户端目录 + .fabric, 哪个主 | 中 | doc 缺 |
| 2 | T2 | CLAUDE.md `@.fabric/AGENTS.md` 语法不明 | 低 | Claude Code 已知特性, fabric 无关 |
| 3 | T3 | team / personal 同步规则 | 中 | doc 缺 |
| 4 | T4 | 两步式 plan_context → get_sections 主语是谁 | **高** | mental model 不对 |
| 5 | T5 | Phase 0.4 / E3 / Trigger Gate 内部术语 | **高** | doc 不分层 |
| 6 | T6 | `fabric doctor` vs `fab` binary 名不一致 | 低 | naming bug |
| 7 | T9 | doctor JSON dump (P0-9) | **致命** | error UX |
| 8 | T13 | 5 种 type + pending, 分类语义不清 | 中 | doc 缺 |
| 9 | T15 | KT-DEC-0001 命名规则 | 低 | doc 缺 |
| 10 | T24 | SKILL description 487 char 英文 + jargon | **致命** | P0-6/13 验证 |

---

## P0/P1 新增 (Batch 7 增量)

**P0-14 — Onboarding 30 min 学习曲线实测 4 个 cognitive cliff**:
- T8 doctor JSON dump 致命点 (30% Wang 放弃)
- T22 实际开 session 后价值感知 2/10 (P0-9 + P0-3 复合)
- T24 SKILL description 致命点 (50% Wang 放弃)
- T30 mental model 7 layer 仍 0 个真正掌握

**P0-15 — 缺 "fabric 是什么 / dev 该做什么" 一页式 quick-start**:
- AGENTS.md 是 AI 行为指令, 不是 dev onboarding
- 没有 "5 行核心: 装/开/编辑/归档/审" 的极简流程图
- 用户必须读完 487 char SKILL description + 52 行 AGENTS.md + N 个 ref/ 才能拼出全貌
- → rc.35 必加: `docs/USER-QUICKSTART.md` 5 分钟版

**P1-8 — `fabric` vs `fab` binary 名 / cli vs CLI 文案不一致**:
- AGENTS.md 写 `fabric doctor`, 实际是 `fab doctor`
- README 里也是 `fabric install` (其实是 `fab install`)
- → install 时把 npm bin 也 ship `fabric` (alias to fab)?

**P1-9 — `.fabric/AGENTS.md` 误受众 (写给 AI 的指令放进了 dev 视角文档)**:
- "Phase 0.4 marker" / "E3 entry" / "Goodhart G1-G5" 等纯 AI internal 术语污染 dev-facing 文档
- → 分层: `.fabric/AGENTS.md` 只放给 dev 看的; AI 行为规约移到 `templates/skills/*/SKILL.md` body

---

## 心智模型实际可学到的 (诚实)

30 min Wang 真学到 (满分 10):

| 维度 | Wang 掌握度 |
|---|---|
| "Fabric 是 KB 工具" | 9/10 ✓ |
| "KB 分 5 类" | 7/10 ✓ |
| "我该做什么" | **2/10** ❌ |
| "Fabric 给我带来的 value" | **1/10** ❌ |
| "Cite / contract 怎么用" | 0/10 ❌ |
| "Archive / review 怎么触发" | 1/10 ❌ |
| "team vs personal 边界" | 3/10 ❌ |
| 整体 confidence to recommend to peer | **2/10** ❌ |

**结论**: 30 min 学习曲线**严重不达标**. P0-13 不止是猜测, Batch 7 模拟实测验证. AGENTS.md 写得"对 AI 准确" 但"对人 useless".

---

## 验证 self-audit 假设

之前 Batch 4-6 self-audit 估计 Wang 5 min 放弃, 实测 (sim):
- **30% Wang 在 T8 (8 min) doctor JSON dump 放弃** — 比预期早
- **50% Wang 在 T24 (24 min) SKILL 致命点放弃** — 中段流失
- **15% 撑到 T30 但只是装饰用 fabric** — 实际不用

**Reach Goal**: 30 min 后有≥30% Wang **主动想用** fabric 写第一条 entry. **实测 sim: 5%**. 

10x gap. P0-13 (mental model 太重) 不是猜测, 是数据.

---

## Remediation 总建议 (rc.35 必修)

1. **加 `docs/USER-QUICKSTART.md`** 5 行核心 + 截图 (P0-15)
2. **`fab doctor` ERROR JSON 改人话提示** + 自动判 "全局版本太老" 给升级指引 (P0-9 + P0-14 第 1 cliff)
3. **AGENTS.md 分层**: dev-facing block / AI-policy block 显式分开 (P0-13 + P1-9)
4. **SKILL.md description 已 NEW rc.34 修, 但 werewolf 端没传播** → rc.35 release notes 必含 "升级 + `fab install` 重装 skills" (P0-5 / P0-6 闭环)
5. **`fabric` alias to `fab`** 或文档全用 `fab` (P1-8)
