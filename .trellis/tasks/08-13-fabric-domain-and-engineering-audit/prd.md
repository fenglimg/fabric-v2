# Fabric 全项目深审:领域最佳性与工程完美度对标

## Goal

回答用户的两个问题,每条结论都带可复核证据:

1. **领域最佳性** —— Fabric 在它所处的领域(面向 AI coding agent 的跨客户端知识 sustainment 层)里,是不是当前最好的项目?
2. **工程完美度** —— 抛开定位,它的工程实现本身是否称得上"完美"?差在哪、差多少?

明确**不是**做什么:不是改代码,不是修 bug,不是发版。产出是一份带证据的评估报告 + 一份可选的 follow-up backlog。

## Requirements

### R1 领域必须先普查再收窄(census before narrowing)

- 不允许拿 1–2 个顺手想到的竞品把结论打死。先枚举"AI agent 记忆/知识层"这个空间里的**全集候选**,逐个标 in-scope / out-of-scope 并写明理由。
- 候选至少覆盖四类:①  agent memory 产品(mem0 / Letta·MemGPT / Zep 类);② rules-file 生态(AGENTS.md / CLAUDE.md / .cursorrules / Cursor Rules);③ 上下文检索层(RAG-for-code、MCP memory servers);④ 团队知识治理(ADR 工具链、Backstage TechDocs 类)。
- 领域边界由 Fabric 自己的定位语句锚定(README:"管团队应记住什么,不是 session 证据库,不是编排器"),但必须检验这个定位本身是否是**为了赢而画的靶子**(self-serving scope)。这一条是硬要求。

### R2 领域对标维度(至少 6 轴,每轴给 Fabric 与竞品的相对位置)

问题域契合度 / 知识生命周期完整性 / 跨客户端可移植性 / 采纳成本(首次到价值的时间) / 治理与可审计性 / 生态与可持续性(用户数、贡献者、维护面积)。

### R3 工程维度必须证据驱动,禁止印象分

每条工程结论必须绑定一个可复跑的命令或可引用的文件/行号。至少覆盖:

- **能不能跑通**:`build` / `typecheck` / `typecheck:tests` / `lint` / `test` 实跑结果(不是看 CI 徽章)。
- **测试有没有效果**:不看行覆盖率下结论。至少对核心包做一次抽样变异/断言强度检查,判断 303 个测试文件是不是在真的杀 bug。
- **架构**:三包(cli/server/shared)边界是否清晰,有无循环依赖与越层引用。
- **发布链路**:CI workflow、版本同步、rc 烧号史反映出的稳定性。
- **文档与真实实现的漂移**:已有 `doc-drift-gate`,验证它的覆盖面是否等于宣称的覆盖面。
- **可维护性负债**:死代码、baseline 债(如 `typecheck-tests-baseline.json`)、TODO/FIXME 密度、包体积与依赖面。

### R4 结论必须分级,不给模糊表态

- 两个问题各给一个明确判定:**是 / 否 / 有条件是**,后接一句话理由。
- 所有差距按 **阻断级 / 显著 / 轻微 / 主观偏好** 四档标注,不混为一谈。
- "完美"按可证伪定义处理:定义为"在本项目自己设定的质量门禁下无已知未修缺口,且这些门禁本身足够严"。两个子条件分开评。

### R5 反过拟合:自评必须被独立挑战

- 执行者自评天然偏高。主评结论产出后,必须至少经过一轮**独立视角复核**(零上下文冷评或对抗式反驳),被驳倒的结论必须撤回或降级,不能沉默保留。
- 复核意见与主评的 gap 本身要写进报告——gap 才是真信号。

### R6 审计发现不当场修

- 发现的问题只登记,不在本任务内改代码。需要修的进 follow-up backlog,由用户决定是否另开任务。
- 例外:纯文档事实性错误(如 README 数字与实现不符)也只登记,不改。

## Acceptance Criteria

- [ ] `research/domain-census.md`:领域候选全集表,每行标 in/out + 理由;Fabric 自身定位的 self-serving 风险有独立一节评估。
- [ ] `research/engineering-evidence.md`:R3 每个子项都有实跑命令 + 原始输出摘录 + 文件/行号引用;无证据项显式标 `UNVERIFIED` 而不是省略。
- [ ] `report.md`:含两个明确判定(是/否/有条件是)、6 轴对标表、四档差距清单、以及"要成为领域最好还缺什么"的最短路径。
- [ ] 报告中每条工程结论可被第三方用文中给出的命令复现。
- [ ] R5 的独立复核已执行,复核 gap 单独成节;被驳回的主评结论已在报告中标注撤回或降级。
- [ ] `backlog.md`:follow-up 问题清单,按四档严重度排序,每条注明预估影响面。未发现问题时显式写"无",不留空文件。
- [ ] 全程零代码修改:`git status` 中除 `.trellis/tasks/08-13-*/` 外无新增改动(会话开始时已存在的 4 个 dirty 路径不计)。

## Notes

- 用户自陈无工程经验:`report.md` 每节开头先用一句大白话说清"这节在看什么、看不好会怎样",再展开技术细节。
- 会话开始时 working tree 已有 4 个 dirty 路径(`.claude/settings.json`、`.fabric/forensic.json`、`AGENTS.md`、`.fabric/install-manifest.json`),属既有状态,不在本任务范围内处理。
- 已知的历史工程教训(rc 烧号、local vs CI typecheck 漂移、worktree 假红)是审计的输入线索,不是结论;引用前须复核是否仍成立。
