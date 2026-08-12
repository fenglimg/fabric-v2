# Implement — 执行清单(经用户批准、task.py start 后执行)

## 顺序清单

1. **轨B取证**: 并行派 3 个 trellis-research agent(server / cli+templates / shared+experimental+仓库级),按 design.md 六维度审计,产出 `research/complexity-*.md`。每条带路径+数字。
2. **轨A判定**: 主线对 20 条机制逐条走 rubric(steal/already-have/skip/需重议);already-have 必须 grep/Read 源码核证(templates 为真源);「需重议」条目单独成组。
3. **合并撰写** `roadmap.md`: 按 design.md 五节结构 + 附录;摘要层大白话。
4. **自检 gate**(对照 prd.md acceptance criteria):
   - 判定表行数 = 20(census 完整)
   - 每条 verdict 有依据引用;steal 有一句话方案;轨B每条有数字
   - 六维度全出现
   - 摘要层无未解释术语
5. **呈报评审**: 向用户交付 roadmap 摘要 + 引导评审(批次顺序拍板)。
6. **评审后**(用户拍板批次顺序): 回写 roadmap 定稿 → fabric-archive 归档关键判定 → task.py finish/finish-work 收口。

## 验证命令

- 判定表完整性: `grep -c '^|' roadmap.md 判定表段`(应含 20 数据行)
- 无产品代码改动: `git status` 中仅 .trellis/ 任务目录与 .claude/settings.json(已完成的环境修复)有变更

## 风险文件 / 回滚点

- 本任务只写 `.trellis/tasks/08-10-trellis-gap-optimization/` 内文件,回滚 = 删任务目录,零产品影响。
- `.claude/settings.json` 修复已完成并验证(node JSON.parse ✓);如需回滚可 `git checkout -- .claude/settings.json`(会回到 fabric-only 版本,Trellis hooks 失效)。

## start 前检查

- [x] prd.md 收敛(方向已裁决,blocking questions 清空)
- [x] design.md / implement.md 在场
- [x] inline workflow,implement.jsonl gate 不适用
- [ ] 用户对最终规划摘要显式批准(本清单执行的前置条件)
