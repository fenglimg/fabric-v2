# Fabric CLI 平铺风设计规范(LOCKED · 2026-06-26)

> 来源:install/uninstall UX grill → 用户选定平铺风 → 双模型(gemini-3.1-pro / 3.5-flash-high)出 11 元素方案 → 收敛 → 可交互原型 v2 用户确认。
> 原型:`fabric_cli_flat_design_system_v2_airy`(已用户拍板)。

## 0. 总原则(最高优先,贯穿所有元素)

1. **保留 clack 框架**:select / multiselect / confirm / text 不自绘、不替换(守 `theme-clack.ts:5` C-006)。
2. **输出区留白呼吸,无竖墙**:Fabric 自绘的所有输出(总结卡 / doctor / config 展示 / 日志 / 进度 / 错误)**不带逐行 `│` 竖线**,纯靠缩进 + 留白分层。
   - 用户实测反馈:逐行 `│` + 实心 `▌` 形成"左竖墙",压迫感强 → 推翻"输出全程对齐 clack 沟槽"的初版方向。
3. **`│` 只在 clack 真正提问的那几行出现**(它自己画的,转瞬即逝)。形成"提问有沟槽 / 输出无沟槽"的诚实节奏。
4. **标题层级**:命令级大标题 = **B 横线**(标题 + 一条 dim 细横线 `──────`);内部分组 = **C 圆点**(`● 分组名`)。**`▌` 实心块全部删除**。
5. **沿用 Fabric 既有调色板**(`packages/shared/src/theme.ts:28`,有 CLI↔hook parity 测试守护,不引新色):
   success 祖母绿 `#2ECC71` / warn 琥珀 `#F1C40F` / error 朱红 `#E74C3C` / accent 紫水晶 `#9B59B6`(仅极轻量点缀)/ ai-info 蓝 `#3498DB` / human 青绿 `#1ABC9C` / muted dim。
6. **状态符号**沿用既有 `✓ / ! / x`(`theme.ts:62`),**不引入** pro 提议的 `● ▲ ■` 新符号集。多选勾选用 `○ / ●`。
7. **i18n**:所有文案过 `t()`,不写死英文;**全部提供 ASCII 无色降级**(`# 标题`、`[ok]/[warn]/[error]`、`( )/(*)`)。
8. **CLI 与 hook 同一套视觉语言(2026-06-26 续)**:CLI 输出与 `.cjs` hook(SessionStart 知识注入 / PreToolUse 提示)长得像、是一套语言——**只升级 CLI 会制造 CLI↔hook 割裂**。`headerRule`(B-横线)**提升到 shared `theme.ts`**(CLI 侧 re-export、hook 侧 `lib/theme.cjs` 镜像取用),SessionStart banner 改用它去 `▌`。改 shared 视觉原语的正确做法:**theme.ts + .cjs 镜像逐字节同步 + 更新 `theme-parity` 断言**(parity 拦的是「只改一边」漂移,不是「不能改」);PALETTE **色值**仍不改(见 §4)。承 KT-DEC-0039(shared renderer over per-surface copies)。

## 1. G1–G6 缺口 → 修复映射(本规范要解决的根因)

| # | 缺口 | 根因(已核行号) | 本规范修法 |
|---|---|---|---|
| G1 | 收尾卡中英夹杂 `succeeded/All steps.../Done!` | `ConsoleOutputRenderer.ts:120,216,230` 硬编码英文未过 t() | 全收进 `t()` + i18n gate |
| G2 | 纯重装误报 `3 installed` 且不折叠 | ① store 阶段 clack 提问触发 `buffer.flushTo()` → `buffer.flushed=true` 旁路折叠(`pipeline.ts:316`);② `buildSummary` 用 `installed.length` 而非 `changed`(`pipeline.ts:403`) | 明细按 `changed===false→已最新`;解开"提问即不折叠"死结,全幂等→安心卡 |
| G3 | uninstall 裸计数 `removed=129 skipped=16` + 黑话 `bootstrap=是` | uninstall 复用 renderer 但无人话结果行 | 套总结卡 + 人话化,与 install 对齐 |
| G4 | clack `┌◇│└` 撞 pipeline `▌├─` 接缝 | 两套画风对撞 | 输出统一留白平铺;`│` 仅留在 clack 提问行(节奏化而非消灭) |
| G5 | 每阶段双行 `[..]`+`[ok]` | `renderStep` 流式两行都留底 | TTY 单行原地刷新(`\x1b[1A\x1b[2K`),非 TTY 只打最终行 |
| G6 | 收尾发散无锚点 | 3 编号 + 重启提示 + 能力行 | 单一"下一步 →"黄金动作,能力表 --verbose |

## 2. 12 元素处理(每个含成本)

| 元素 | 处理 | clack 边界 | 成本 |
|---|---|---|---|
| 会话框架 intro/outro | B 横线开场 + 留白扫描信息 + 一行人话收尾;删 `▌`/`└` | intro/outro 经 theme-clack | 低 |
| select 单选 | clack 提问块(带 `│ ◇`)+ 选中行上色 + 提问完**留白 ✓ 回执** | 控件原生不动 | 中 |
| multiselect 多选 | 同上;已选用琥珀色暗示破坏性;留白单行回执 | `○ ●` 勾选态 | 中 |
| confirm 确认 | clack y/N;Yes→留白 `✓` 回执,No→朱红 `x` | 原生 | 低 |
| text 输入 | clack 输入块带默认值提示;提交后留白 `✓` 回执 | 原生光标 | 中 |
| spinner/进度 | 单行原地刷新(治 G5);完成 `✓`、进行中蓝 `⠙`;非 TTY 静态 | — | 高 |
| note/log 四级 | 去气泡框 + 去竖线,留白平铺,`ℹ/✓/!/x` 点色 | theme-clack buildLog 扩展 | 低 |
| 总结卡(有改动) | B 横线标题 + 留白逐项人话 + 单一下一步(治 G6) | 纯输出 | 低 |
| 安心卡(纯重装) | 全幂等塌成体检卡,绝不误报 installed(治 G2) | 纯输出 | 中(解 flushed 旁路) |
| fabric doctor | B 横线标题 + 健康徽章 + C 圆点分组(可修复/人工检查)+ 修复引导;废树形线 | 纯输出 | 中 |
| fabric config | 留白键值展示 → clack select 改值(带 `│`)→ 留白 `✓` 回执 | select/text 原生 | 中 |
| 错误/取消 | 捕 `isCancel`,留白人话 + 回滚出声;收尾朱红 `x`,不抛裸堆栈 | isCancel | 低 |

## 3. 落地顺序(双模型收敛一致)

1. **低成本视觉底色**:会话框架 + note/log 四级 + 错误/取消态(全局留白基调)
2. **低成本痛点**:总结卡(治 G2 误报 + G6 单锚点)+ G1 i18n 硬编码全收 t()
3. **中成本**:安心卡折叠(解 `buffer.flushed` 旁路)+ spinner 单行(治 G5)
4. **中成本控件适配**:select / multiselect / confirm / text 的回执行 + 文案
5. **高成本独立命令**:doctor 报告重排 + config 展示/编辑流 + uninstall 套总结卡(治 G3)

## 4. 红线 / 非目标

- 不替换 clack、不自绘交互控件(C-006)。
- 不改 PALETTE 色值(parity 测试)。
- 提问行的 `│` 保留(clack 原生),非缺陷;若日后要连提问 `│` 也去,属 clack 主题改造,单列。
