# 轴 5 · 安装物件必要性普查(install payload census)

> 用户 2026-08-10 新增方向原话:「对于安装的每一个物件都需要批判看待是否必要,有一些是历史产物没有作用但是还是进行了安装之类的」。
>
> 与已完成的 #16「安装副本漂移」是同一枚硬币两面:漂移检测问「装下去的还对不对」,本轴问「这东西本来就该不该装」。

## 0. 方法

判据不是「有没有被 grep 到」,而是**从客户端真正会调用的入口出发做传递可达性**。`fabric install` 的分发清单在 `packages/cli/src/install/skills-and-hooks.ts`,入口集合是 `packages/shared/src/hook-registrations.ts` 的 `HOOK_REGISTRATIONS`(W2 刚建的唯一真源)。

**必须读源模板,不能读安装副本**(KT-PIT-0048):`.claude/` / `.codex/` 下的是本仓自己装的副本,可能落后于 `packages/cli/templates/`,据它下架构结论会得出反向答案。

普查脚本(一次性,结果见下)对 `templates/hooks/` 做 require 图遍历,root = 6 个注册入口。

## 1. 全集与结论

| 物件类 | 数量 | 结论 |
|---|---|---|
| hook 入口脚本 `templates/hooks/*.cjs` | 8 | **全部可达**,0 死文件 |
| hook 共享库 `templates/hooks/lib/*.cjs` | 33 | **33/33 可达**,0 死文件 |
| skill `templates/skills/*/SKILL.md` | 6 | 全部安装且被引用;thin shim 合并已裁决不做(见 I3) |
| skill ref companion `*/ref/*.md` | 32 | **1 条确凿缺陷**(已修,见 I1) |
| skill 共享策略 `skills/lib/*.md` | 1 | 可达 |
| hook config 模板 `hooks/configs/*.json` | 2 | 已被 W2 的 template-parity 测试钉住 |
| 永久清扫清单 `DEPRECATED_SKILL_DIRS` | 10 | ✅ 已整条清空,连同 uninstall 侧 4 个镜像 sweeper(见 I4) |

**hook 层是干净的** —— 这条轴在 `.cjs` 上没有矿。所有 33 个 lib 都被 6 个注册入口传递需要,8 个顶层脚本也全部可达。这个结论本身有价值:它把「删死 hook」从待办里划掉,免得后续再花一轮去查。

真正的问题不在「有没有死文件」,而在**分发清单的描述与事实脱节**。

## 2. I1 — recall-playbook 的 ref 从来没被装过 ✅ 已修 (commit 4585235a)

`fabric-recall-playbook/SKILL.md` 两处指示 agent 打开 `ref/scenarios.md`,但 `FABRIC_SKILL_INSTALL_SPECS.fabricRecallPlaybook` 没设 `includeRefFiles`,该文件从未写进用户工作区。装下去的 skill 让 AI 去开一个不存在的文件。

**根因不是漏设一个布尔值,是这个布尔值本身**。`includeRefFiles` 有三份真相:

1. `skills-and-hooks.ts` 的 install spec;
2. `uninstall-skills-and-hooks.ts` 的 `RemoveSkillOptions`(独立手写的一份);
3. 模板目录里到底有没有 `ref/` —— **这才是事实**。

前两份是对第三份的手抄。而两侧的实现(`installSkillRefFiles` / `removeSkillRefFiles`)**本来就优雅处理「没有 ref/」**(分别返回 `no-ref-dir` / `absent` 跳过行),所以标记从一开始就是纯冗余的漂移源。

修法:删掉标记,两侧无条件调用,让文件系统当唯一真源。这同时消掉一对手写孪生(与 B8 同一族的病)。

补 `__tests__/skill-ref-payload-roundtrip.test.ts`(24 tests)作为 producer-consumer round-trip oracle —— 跑真安装再回读磁盘,双向都查:

- **消费者→生产者**:SKILL.md 点名的每个 `ref/x.md` 必须真落到每个 client 目录;
- **生产者→消费者**:模板里没人引用的 ref 是死负载(这一条就是本轴的常驻 census gate,新加 ref 必须被 prose 链接,否则删)。

**变异实证**:重新 guard 掉 recall-playbook 后精确红在该 skill 的两条上,其余 22 条绿 —— 非零判别力,不是又一组只跑不判的测试。

> 教训(已成文,待归档):**只检查模板侧或只检查安装侧都是假绿**。本例中模板全部解析正常、每个 installer 都报成功,缺陷只在「跑完安装再回读磁盘」时暴露。这是 producer-consumer oracle 在分发链上的又一次兑现。

## 3. I2 — knowledge-hint-narrow 装在入口位却零注册(待办)

`HOOK_SCRIPT_DESTINATIONS.knowledgeHintNarrow` 把 `knowledge-hint-narrow.cjs` 装到 `.claude/hooks/` 和 `.codex/hooks/` **顶层**,但 `HOOK_REGISTRATIONS` 里**没有任何客户端注册它**。它早已退化成 `knowledge-pretooluse.cjs` 的一个 lib(ux-w2-6 合并「双弹」时的产物),却还留在入口位置。

同类:`cite-policy-evict.cjs` 在 Claude Code 侧也只是 lib(仅 Codex SessionStart 注册它),但同样装在顶层。

**这不是死文件**(两者都必须继续分发),是**分类错位**,代价是真实的:

- 顶层 `.cjs` 看起来像入口,让人(和 AI)以为它由某个事件触发,读代码时按错误的心智模型推理;
- doctor 的 wired 检查只查注册表里的入口,顶层的非入口脚本落在两不管地带;
- `FABRIC_HOOK_COMMAND_PATHS` 已经为此挂了「legacy-only prune target」的补丁注释(W2 期间写的),说明这个错位已经在向别处渗透。

**提议**:把两者移进 `hooks/lib/`,由 `HOOK_LIB_DESTINATIONS` 统一分发;旧路径进 deprecated 清扫清单(rescue-before-delete:这是纯代码副本,数据无风险,直接 sweep 即可)。

**风险**:动分发路径,要同步改 uninstall 两处引用(`uninstall-skills-and-hooks.ts:291` / `skills-and-hooks.ts:839`)、POSIX exec bit 测试、以及 `knowledge-pretooluse.cjs` 的 require 相对路径。中等风险,7 ship gate + 新增的 round-trip oracle 兜底。

## 4. I3 — 两个 thin shim skill 的常驻描述税 ❌ 用户裁决:不做

6 个 skill 的 SKILL.md 体量:archive 230L / review 223L / recall-playbook 92L / config 71L / **store 30L / sync 28L**。

`fabric-store` 与 `fabric-sync` 是纯「意图→命令」映射表 + 3-4 条红线,自述为 "thin shim"。skill 的成本不是磁盘字节,是 **description 行常驻每个会话上下文**,以及 AI 在 N 个 skill 间做选择的判断负担。

- **留的理由**:红线是 `--help` 说不出来的(`store remove` = detach ≠ delete;store 是 data-only,hook/skill 永不直接解析;破坏性 migrate 必经 CLI confirm 门)。这些是真知识。
- **删/并的理由**:两者都以「其余全交 CLI」收尾,`fabric-sync` 明说唯一需要 AI 的只有 rebase 冲突辅助一步。两个 28/30 行的 skill 各占一条常驻 description,合并成一个 `fabric-store`(含 sync 小节)可省一半税。

**裁决(2026-08-10)**:不合并。红线内容有真价值,省下的那一条 description 不值得换取「store 运维」与「store 同步」两个意图挤进同一个 skill 的辨识度损失。

## 5. I4 — 清空历史清扫机制 ✅ 已完成 (commit da51bcf6)

10 条目录每次 `fabric install` 都 rm -rf 一遍,最老的 `fabric-init` 来自 rc.35。清扫成本近似为零,但清单**没有退役判据** —— 只会一直涨。

问题不是性能,是它把「哪些是历史包袱」这件事**永久钉在活代码里**。零用户阶段(见 clean-slate 偏好)理论上可以整条清空。

**裁决(2026-08-10)**:清空。零用户阶段(clean-slate 偏好)不背 pre-W3-C 包袱。

**关键发现 —— 清扫机制是成对的**。这 10 条目录在 uninstall 侧有 4 个打**同一批目录**的 legacy sweeper(`uninstallFabricRouterSkill` / `Import` / `Audit` / `Connect`),只清 install 一边会留下自相矛盾的半套机制。两侧一起拆才是完整的。

**连带发现 —— 代码删干净了,指向死物的字还在**。拆完 grep 已折叠 skill 的名字,抓出两处**用户可见**文案:

- `preview.ts` 的未关联条目提示让用户「用 fabric-connect 建边」,该 skill 早已折进 `fabric-review` 的 relate 子流程;
- `plan-context-hint` 的 `--help` 描述称自己被 fabric-import skill 调用。

另有三处严重过期的模块 doc:`skills-and-hooks.ts` 头注称 wiring site 是已退休的 `commands/install.ts`、`hooks-orchestrator.ts` 列着 8 步实际 6 步且步骤编号断裂、`SKILL_DESTINATIONS` 头注说「5 skills」实为 6。

> **教训**:删一个历史机制时,要顺着它的「服务对象」(被清扫的那些名字)再全仓 grep 一遍文案与注释。机制没了,而指向死物的字会继续骗人 —— 其中用户可见的那部分是真 bug,不只是注释债。

## 6. 未发现问题的面(还了清白)

- `templates/hooks/lib/` 33 个文件全部可达,无一冗余;
- `skills/lib/shared-policy.md` 被两个 leaf skill 引用,活的;
- `hooks/configs/*.json` 已由 W2 的 template-parity 测试与 `HOOK_REGISTRATIONS` 双向钉死;
- env stage 写的 `.fabric/` 产物(fabric-config.json / events.jsonl / .gitignore / AGENTS.md)每一件都有活消费者。

## 7. 与其他轴的关系

- **轴 4(变异测试)**:本轴新增的 round-trip oracle 已按轴 4 的判据做过变异验证,不是只跑不判的测试。
- **W2 #16(安装副本漂移)**:manifest 若落地,应把 skill ref 文件一并纳入 hash 清单 —— I1 这类「该装没装」正好是 manifest 的空档(manifest 只能查已装文件的字节,查不出缺席条目),两者互补而非重叠。
- **轨T(文档瘦身)T4**:「skill ref 树瘦身」与本轴的「生产者→消费者」死负载检查同源,T4 执行时可直接复用新测试当 gate。
