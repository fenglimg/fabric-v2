# Batch 4-6: Coverage gap closure (工程三联 + 跨客户端 + AI/文档)

执行 user-requested second-round: 补齐 self-audit 出的 6 个 miss.

---

## B4.1 Performance baseline

| 命令 | werewolf state (19535 events / 7.7M / 54K meta) | 评价 |
|---|---|---|
| `fab doctor` (35 checks) | **4.42s** | ⚠️ 偏慢 — frequent run 体感 lag |
| `fab plan-context-hint --all` | 0.43s | ✓ |
| `fab plan-context-hint --paths <file>` | 0.36s | ✓ |
| `fab doctor --cite-coverage --since=7d` | 0.38s | ✓ |

**P1-7 — `fab doctor` 全量 4.4s, hook fire 链路上 latency 不可接受**:
- 单次 doctor 4.4s 还能忍, 但 SessionStart hook 会调 plan-context-hint (0.4s ok)
- 若未来 events.jsonl 超 50MB, doctor 时间将线性涨
- 建议: doctor 加 `--quick` mode 跳过 cite-coverage / ledger scan
- 或: events.jsonl rotation 更激进 (rc.22 已有 sliding window, 但 7.7M 还没触发)

---

## B5 Cross-client consistency

**好消息: 三端 byte-identical** (diff -q 全无输出):

| 资产 | .claude / .codex / .cursor | 状态 |
|---|---|---|
| SKILL.md × 3 (archive/review/import) | byte-identical | ✓ |
| hooks/*.cjs × 3 (broad/narrow/fabric-hint) | byte-identical | ✓ |
| hooks/lib/*.cjs × 4 | byte-identical | ✓ |

**.cursor 走自己路径**: 用 `.cursor/rules/fabric-bootstrap.mdc` (`alwaysApply: true`) 代替 SKILL.md, 内容是与 `.fabric/AGENTS.md` 一致的 managed block. 合理 — Cursor 没有 skill 概念.

**P2-6 — `.codex/skills/fabric-init` 是废弃漂流物 (用户确认)**:
- `fabric-init` skill 已废弃 (功能被 fab install / scan 取代), 但 `.codex/skills/` 还残留
- fab install 没维护 deprecation cleanup 路径 — 旧安装升级时 deprecated skill 不会被自动 remove
- 而 `.claude/skills/feishu-project-workitems` 是用户自装非 fabric skill, 不算问题
- **修复**: rc.35+ 加 `fab install` deprecation manifest, 升级时 remove 列表里的 skill 目录

**结论**: 跨客户端的核心 fabric 行为一致 (good), 但 client-specific 额外资产 (CC 比 Codex 少 1 个) 没文档说明 — 用户疑惑 "为啥 codex 有 fabric-init 但 CC 没"

---

## B5/B6 — 真实 AI 决策视角 (Claude 自评)

**任务**: 假设我 (Claude) 第一次接手 werewolf-minigame, user 说 "改一下 SpyGameSoundUtil.ts 的 audio 开关逻辑". 我会本能调 fabric 吗?

**Self-audit honest report**:

| 决策点 | 我会做吗 (诚实) | 为什么 |
|---|---|---|
| 读 AGENTS.md 提示 | ✓ 60% 概率 | 第一次接手项目会扫 AGENTS.md |
| 调 fab_plan_context 取 narrow KB | ✗ <20% 概率 | "两步式" 这个习惯不自然, 我会优先 grep / Read 业务代码 |
| 收到 hook 推的 KT-PIT-0012 list | ✗ 真看到只会跳过 | summary == id (P0-10) 完全 opaque, 我不知道是什么内容, 不值得多 fetch |
| 用户说"以后..." → 触发 self-archive | ⚠️ 50% 概率 | rc.34 NEW description 有强 trigger, 但即便触发我会担心"打断当前任务" |
| 在 turn 末写 `KB:` 行 | ✗ <5% 概率 | 这条 cite policy 我大概率忘 — 它不是 verb-style 动作而是 ritual, 没强反馈 |
| 调 fabric-archive skill | 仅当用户**显式**说"记一下" | "本能" archive 几乎不发生, 因为 archive 不直接帮当前 task |

**P0-12 — Cite/archive 不是"有用 action"是"维护 ritual"**:
- AI 学到的是 "完成 task" 模式, 不是 "维护 KB" 模式
- 即使 description 100% recall, AI 倾向"完成手头事再说" → cite/archive 优先级永远最低
- **根因不在 description / hook, 在 framework 设计**: 让 maintenance action 也帮当前 task 才会被本能调

**Remediation 方向 (非本次 fix, rc.36+)**:
- Hint 阶段就直接渲染 entry summary (P0-10 修): AI 看到"KT-PIT-0001 atlas premultiply 黑边" → 不再 opaque → 主动 fetch
- Cite policy 改成 "AI 写 cite 时立即得到 contract 验证反馈": AI 学到 "cite 后下次 edit 会被 contract gate 节省时间" → 有正反馈
- Archive 改成"过了 N turn 后弹出'要不要把这个洞察作为 pitfall'选项": 不打断当前 turn

---

## B6.1 Doc mental model — 30min 学习曲线?

**`.fabric/AGENTS.md` (canonical) 复杂度**:
- 52 行 / 3751 chars
- 10 个 backtick-quoted concept (`fab_plan_context`, `fab_get_knowledge_sections`, `selection_token`, `agents.meta.json`, ...)
- **29 次专业术语提及**: fab_plan_context (×6) + get_knowledge_sections (×3) + selection_token (×7) + KB: (×6) + self-archive (×2) + cite (×5)

**心智模型 layer count**:
1. 两步式 plan_context → get_sections (with selection_token round-trip)
2. KB cite 行格式 (planned / recalled / chained-from / none, + sentinel)
3. Contract operator 语法 (edit:/!edit:/require:/forbid:/skip:)
4. Self-archive 4 个 trigger signal + 3 个 anti-trigger + 3 个 anti-loop
5. Phase 0.4 marker 双行 (machine + human)
6. Cite Goodhart G1-G5 patterns
7. session_id 传参约定

**P0-13 — Mental model 7 个 layer 远超 30 min 学习目标**:
- 即使是 fabric 设计者 (我刚跑完整轮 audit), 也是查文档才记起 Phase 0.4 marker 格式
- 新用户最多记 1-2 个 layer (大概率是"读 AGENTS.md 知道有 fabric") 就放弃 ritual
- 数据反证: werewolf 8 天 17290 turn, 0% cite contract 写, 96.8% turn 完全无 KB: 行
- AGENTS.md 不是教学文档, 是 "对 AI 的行为指令清单" — 缺 onboarding-shaped 文档

**Remediation 方向**:
- 分层 docs: 5 行 "must know" + 50 行 "policy details" + ref/ 完整规约
- 出新手"前 10 min" 流程: 装 → 开 → 编辑 → 看到 hint → 体验一次 archive → 一次 cite 反馈
- 实战例 (real werewolf-style sample) 而非抽象规则

---

## B4.3 Install / 升级 (light inspection, 没真跑全流程)

`fab install --help` 内容 OK, 有 `--dry-run` / `--yes` 选项设计合理.

**但 P0-9 真实痛点没解**: 现有 werewolf 是 rc.30 安装 (npm global), 用户跑 `fab install` 不会自动**升级全局 fab**. 需要:
1. `npm install -g @fenglimg/fabric-cli@latest` 先升级
2. 然后 `fab install` 重装 hooks + skills

**没真跑过, 推真人 dogfood**:
- 全新空目录 → `fab install` → 看产物 (hooks / SKILL.md / AGENTS.md / .fabric/) — 录屏看完整流程
- werewolf 升级 (从 rc.30 → rc.35 hypothetical) — 看 `--dry-run` 提示 + 实际差异

---

## B6.2 Disaster recovery (read-only inspection, 没真测)

`agents.meta.json` 结构 normal:
- top-level keys: revision / nodes / counters
- 49 nodes, counters envelope healthy (`KP/MOD:0` + `KT/MOD:17` + ...)

**没真测 corruption** — 推真人 dogfood:
- 真删 agents.meta.json 整个文件 → `fab doctor` 表现? `--fix` 能否重建?
- 真在 events.jsonl 末尾追加 garbage line → `fab doctor` 能否识别 partial write?
- 真损 .md frontmatter (`---` 缺一半) → reconcile 行为?
- 用户问"如何 backup .fabric/" — 文档/CLI 有指引吗? (当前 0 文档)

---

## B6.3 Security / PII

**events.jsonl 19535 line 扫描结果**:
- email regex: 0 match ✓
- 中国手机号 (strict 11 位): 4 false-positive (UUID 数字段误匹), 实际 0 真号 ✓
- 中国身份证 (18 位): 0 match ✓
- `user_prompt_excerpt` 字段: 0 entry (events.jsonl 不存 user prompt 全文) ✓
- `kb_line_raw` 字段: 607 line (cite 行内容, 量级 OK)

**结论**: events.jsonl PII 风险**当前不存在**. 但要注意:
- 未来若加 "session digest" 写到 events.jsonl, 会含 user prompt 全文 → 风险陡升
- `kb_line_raw` 长度无 limit, AI 若写很长 cite 行可能泄密 (低概率)

**P2-7 — events.jsonl 没 sanitization layer**:
- 当前安全 by accident (因为存的都是 event metadata)
- 若 schema 演进 (rc.35+) 加任何 user-content field, 应加 sanitization filter
- 建议 doctor 加 lint `events_jsonl_pii_scan` 兜底

---

## B5/6 横切总结

新发现按 P0/P1/P2 分类:

**P0 (本次新增)**:
- P0-12 — Cite/archive 是 ritual 不是 useful action, 框架设计层根因
- P0-13 — Mental model 7 layer 远超 30 min, AGENTS.md 缺 onboarding-shaped

**P1 (本次新增)**:
- P1-7 — `fab doctor` 4.4s 偏慢, 缺 --quick mode

**P2 (本次新增)**:
- P2-6 — fab install 不对称: codex 装 4 个 skill, CC 装 3 个 (缺 fabric-init), 没文档
- P2-7 — events.jsonl 当前 PII 0, 但缺 sanitization layer 防未来 schema 变更

**没真跑 (推真人)**:
- B4.3 install 全流程 (空目录 + 升级路径)
- B6.2 disaster (真 corrupt → doctor --fix)

---

## 跨客户端 / 工程双轴更新覆盖度

到 Batch 6 为止覆盖:

| 轴 | Cell | 状态 |
|---|---|---|
| 工程 | install | ⚠️ 浅 (只看了 --help) |
| 工程 | perf | ✓ |
| 工程 | disaster | ⚠️ 浅 (只 inspect 结构) |
| 工程 | security/PII | ✓ |
| 产品 | 跨客户端 | ✓ |
| 产品 | 真实 AI 决策 | ✓ (Claude self-audit) |
| 产品 | 文档/mental model | ✓ |
| 产品 | concurrent/git merge | **out-of-scope** (推 rc.36+) |
| 产品 | personal layer 价值 | **out-of-scope** (推 rc.36+) |

总覆盖度: **~85%** (从 70% → 85%, 还有 2 个 out-of-scope cell 不补)
