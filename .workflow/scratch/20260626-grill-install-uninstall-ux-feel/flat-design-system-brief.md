# Design Brief: Fabric CLI「平铺风」全套交互设计系统(保留 clack)

## 背景与已锁定约束(必读,不可推翻)

Fabric 是跨 AI 客户端(Claude Code / Codex CLI)的知识层 CLI,Node + TypeScript,终端运行,中英 i18n。
上一轮已确定**视觉走"平铺风"(flat)**:无重边框、靠缩进与留白分层、每行一句人话状态。现在要把它扩成**覆盖所有交互元素的设计系统**。

**硬约束(用户已拍板,设计必须在此框内):**
1. **保留 clack 框架,不替换交互控件**。`theme-clack.ts:5-8` 的 `C-006 SCOPE LOCK` 明文:select / multiselect / confirm / text 这些 @clack/prompts 控件保持框架原生,**不自绘、不重写**。
2. 因此核心命题不是"让 clack 迁就我们",而是 **"让 Fabric 自绘的输出去说 clack 的方言"** —— 统一采用 clack 的左竖线 `│` 沟槽 + `◇ ○ ●` 符号词汇 + 平铺留白,使「提问(clack 画)→ 结果(我们画)」读起来是**一条连续的流**,消除当前的画风对撞接缝。
3. **沿用 Fabric 既有调色板**(下方),不引入新色值(有 CLI↔hook parity 测试守着 `theme.ts` PALETTE,改色成本高)。

## 真实调色板与符号(grounded,直接用)

palette(`packages/shared/src/theme.ts:28`):
- success 祖母绿 `#2ECC71` · warn 琥珀 `#F1C40F` · error 朱红 `#E74C3C`
- accent/headers 紫水晶 `#9B59B6` · ai/info 蓝 `#3498DB` · human 青绿 `#1ABC9C` · muted = dim 灰
符号(`theme.ts:62-67`):ok `✓` / warn `!` / error `x`;ascii 兜底 `[ok]/[warn]/[error]`。
section 标题(`theme.ts:75`):`▌ 标题`(紫水晶加粗)/ 无色降级 `# 标题`。
clack 原生沟槽:`┌`(intro)`◇`(当前提问)`│`(沟槽)`○`未选 / `●`已选(multiselect)`└`(outro)。

## clack 能控 vs 不能控(设计的真实边界)

| 能控(放手设计) | 不能控(clack 自画,顺着它) |
|---|---|
| prompt 的 `message` 文案、option 的 `label`/`hint` 文案 | select/confirm 控件被选中行的高亮渲染、键盘导航重绘 |
| intro / outro / note / log(已可经 `theme-clack.ts` 主题化) | clack 沟槽字符 `┌◇│└` 与其默认配色(基本固定) |
| 提问**前后**我们自绘的状态行 / 卡片 / 标题 | multiselect 的 `○/●` 勾选态绘制 |
| 全部"输出类"界面:doctor 报告、config 展示、总结卡、进度行、错误/取消收尾 | text 输入的光标行 |

**结论**:把"能控"的全部对齐到 clack 的 `│` 沟槽 + 平铺留白 + Fabric palette,clack 的"不能控"部分就会显得是刻意设计而非异物。

## 要你设计的元素清单(每个给平铺风 mockup + clack 适配说明 + 成本 低/中/高)

1. **会话框架**:intro(命令开场)/ outro(收尾),如何与下方所有元素的沟槽统一。
2. **select 单选**(真实场景:`config.ts:344` 选字段、store 选团队库):message + options 文案怎么写、提问前后我们补什么框,使 clack 默认控件不突兀。
3. **multiselect 多选**(真实场景:`uninstall` 选卸载部分):同上。
4. **confirm 确认**(Y/n,33 处在用):提问文案 + 选后我们的回执行怎么平铺。
5. **text 输入**(`config.ts:467` 阈值、store 命名):带校验/默认值的输入前后框。
6. **spinner / 逐阶段进度**(治 G5 双行):单行原地刷新的平铺呈现 + 非 TTY 降级。
7. **note / log 四级**(info/success/warn/error):左竖线分组块的平铺版。
8. **总结卡**:安装完成 / 纯重装"安心卡"(治 G2 误报 3 installed)/ 卸载完成。
9. **`fabric doctor` 报告**:现状是 `▌标题 + tree 行 + 状态徽章`(`doctor.ts:419`)。给平铺版:健康状态头、检查项分组(fixable/manual/warnings)、store 健康、payload 限额。
10. **`fabric config` 展示 + 编辑菜单**:字段列表展示 + select 进入编辑 + text 改值 + 写回回执的整段平铺流。
11. **错误 / 取消态**:clack `isCancel`(20 处)被取消、命令失败、回滚出声的平铺收尾。

## 约束与交付

- 终端宽度 80–100 列;中英 i18n 友好(文案别写死英文,走 `t()`);颜色必须可降级 ASCII 无色(给降级示意)。
- 交付 markdown:每个元素一段 = 等宽终端 mockup(颜色用 `[紫]▌[/]` 这类标注对应上面 palette)+ "clack 能控的部分我怎么设计 / 不能控的部分我怎么顺" 说明 + 实现成本(低=纯输出换皮 / 中=theme-clack 扩展 / 高=触碰 clack 边界)。
- 末尾给"推荐落地顺序"(先摘哪些低成本高收益)。
- 红线:不得提议替换 clack 或自绘控件(那是已否决的 non-goal)。
