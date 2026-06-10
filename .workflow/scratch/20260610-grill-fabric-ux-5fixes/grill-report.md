# Grill Report: Fabric 5 项 UX/数据修正(install 语言 / enum 收窄 / uninstall / store 目录 / 团队库 id)

**Session**: 20260610-grill-fabric-ux-5fixes
**Depth**: standard(5 concern → branch-mapped)
**Date**: 2026-06-10
**Upstream**: 用户 install/uninstall 实跑 transcript + 5 条观察
**Prior**: 20260610-grill-fabric-install-uninstall-ux(C1–C5,已 sealed + 已实现于 commit c66c7a5)——本轮为后续新一批

---

## Discovery（code-grounded,✅一致 / ⚠️部分 / ❌矛盾）

### ① 语言不一致 — ⚠️ 诊断需修正:不是"默认没设 zh-CN",是两套 resolver 各管各的
- **向导显示语言** = `detectNodeLocale()`(env `FAB_LANG`→`LANG`→`en`),`packages/cli/src/i18n.ts:16`。中文系统 → 向导说中文。
- **固定的 `fabric_language`** = 扫 README/docs 的 CJK 占比,`packages/cli/src/lib/detect-language.ts`(本仓 README 英文为主 → 判 `en`),由 `writeDefaultFabricConfig` 覆写,`install-scaffold-config.ts:52-80`。
- 结果:向导中文 + 知识语言 en,两值各自正确但来源无关联;`guidance.stage.ts:74` 收尾 hint `cli.install.language_preference_hint` 把裂缝暴露。
- ∴ 改 schema 默认值治不了根——install 走"探测后覆写",不走默认值这条路。

### ② 只留 zh-CN | en — ✅ 成立
- Enum 现 4 值:`fabric-config.ts:56` `["match-existing","zh-CN","en","zh-CN-hybrid"]`,默认 `match-existing`(`:133`)。
- type 镜像 `shared/src/types/config.ts:23`。`detect-language.ts` 会产出 `zh-CN-hybrid`;`resolve-fabric-locale.ts` 把 hybrid 映射到 zh-CN base、把 match-existing 当 pre-init 占位符告警降级。
- ①②同根:砍掉 `match-existing`+`zh-CN-hybrid` → 探测路消失,语言只能"问"或"跟随向导" → ①矛盾自动消失。

### ③ uninstall 不专业 — ✅ 三处确认
- `packages/cli/src/commands/uninstall.ts`:① 开头 `note` 概览框线未对齐 ② 6–7 连续 `[Y/n]`(target 确认 `:593` + `confirmDestructive` `:238/:690` + scaffold/bootstrap/mcp 三 `confirmInGroup` `:610-628` + review `:658`)③ 卸载计划被打印两遍(note 概览 + review)。
- 对比 install 的勾选 select + 分阶段进度,显糙。

### ④ store 目录 + 缺类目 — ⚠️ "缺类目"是观感,目录结构是设计选择
- **缺 model/process = 懒创建**,非 bug:5 类目俱全(`shared/src/schemas/store.ts:166` `models/decisions/guidelines/pitfalls/processes`);当前 MOD=0/PRO=0 故无目录(`~/.fabric/stores/{personal,team}/counters.json` 实测)。
- **当前结构 = 单层 `stores/<mount_name>/`**(`stores/personal/`、`stores/team/`,`fabric-global.json` mount_name=alias)。store 身份 = `store.json.store_uuid`;`KP-`/`KT-` 前缀按条目 `layer` 派生(`agents-meta.ts:238`),store ⊥ scope:一个物理库可同时装个人/团队条目。

### ⑤ 团队库 9000+ id — ✅ 测试种子污染了真实远端
- `~/.fabric/stores/team/knowledge/decisions/` 含 `KT-DEC-9001--manual-rc3-fallback-test.md`、`9002--file-boundary…`、`9003--…`、`9004--init-fixate-knowledge-language.md`;counters 顶到 `KT.DEC=9004 / KT.PIT=9105`。
- 来源远端 `https://github.com/fenglimg/fabric-team-knowledge`(clone)。清理 = 重命名文件 + 改 frontmatter id + 重置 counters + push 回远端。

---

## Synthesis — Locked Decisions

| # | 决议 | 状态 | 证据 / 护栏 |
|---|------|------|------------|
| D1 | **统一为单一全局语言:`~/.fabric/fabric-global.json` 加 `language: "zh-CN"\|"en"`,作唯一真相,管界面+知识** | locked | `store.ts:255-266` 根 passthrough,加字段零阻力;`i18n.ts`(界面)+`resolve-fabric-locale.ts`(知识)统一改读全局 `language`,env `FAB_LANG`/`LANG` 降兜底;**连根删 README 探测(`detect-language.ts` 启发式)+ 项目级 `fabric_language` 探测覆写** —— ① 病根 |
| D1b | **开局选语言:首次 install 若全局 `language` 未设 → 弹 zh-CN/en 选择器(游戏首启感),写回后永不再问;`fabric config` 可改** | locked | 全局唯一、**不留 per-repo 覆盖**(用户拍板);clean-slate |
| D2 | **enum 收窄为 `["zh-CN","en"]`,删 `match-existing`+`zh-CN-hybrid`** | locked | `fabric-config.ts:56`+`types/config.ts:23`+`detect-language.ts`(退役)+`resolve-fabric-locale.ts`(删占位符/hybrid 分支)+`parity-matrix.json` |
| D6 | **install 绑定 team store 项目 = 默认 git 名静默,仅歧义时弹一次**:① store 无项目 → 静默用 git 名 ② git 名命中已有项目 → 静默加入 ③ **唯一例外:store 已有项目 且 git 名不匹配 → 弹 select(➕新建 `<git名>` vs 加入已有 X/Y/Z)**;`-y` 全程静默 | locked | 防"join 共享库时静默新建平行项目→知识分裂"(`store-project-onboarding.ts:68` `project_created` 实锤)。数据 `storeProjectList` 已在 `:67` 拉取,仅加 `if(有项目 && 未命中)` 分支。常见路径零提示,符合"用确定性默认值、少问"哲学 |
| D3 | **uninstall 对齐 install:勾选式 select + 单次最终确认,删重复 plan 打印与冗余确认** | locked | `commands/uninstall.ts` wizard 段重构;合并 `confirmDestructive` 与 wizard execute confirm 为一次;框线对齐 |
| D4 | **store 目录改两层 `stores/personal/<repo-name>/`、`stores/team/<repo-name>/`** | locked | **护栏:目录名=remote 派生标签,真身份仍 UUID;改名只让标签旧、不破查找,doctor --fix 刷新;无 remote 的新建库用 alias/UUID 短码兜底**。分组 personal/team 由 `personal:true` flag 决定。承认代价:团队侧可能出现"个人条目(KP-)躺 team/ 文件夹"的观感错位(用户已权衡接受) |
| D4b | install 预创建全 5 类目空目录(`.gitkeep`),让结构可见完整 | locked(low-stakes) | 解 ④"缺类目"观感 |
| D5 | **团队库 9000+ → 重排连续 id(KT-DEC-0010…)+ 重置 counters + push 回 `fenglimg/fabric-team-knowledge`** | locked | pre-user / clean-slate;接受引用这些 id 的 cite 失效 |

## 实施状态 (2026-06-10, feat/grill-6fixes-ux)

| 决议 | 状态 | commit |
|------|------|--------|
| D1/D1b/D2 语言统一全局基调 | ✅ 已实现+测试绿 | 39c266b |
| D6 team store 项目歧义守卫 | ✅ 已实现+测试绿 | 9bae588 |
| D3 uninstall 对齐 install | ✅ 已实现+测试绿 | 6f8bc22 |
| D5 团队库 9000+ renumber | ✅ 已 push 远端(be976bc @ fenglimg/fabric-team-knowledge) | — |
| D4b 预建 5 类目空目录 | ✅ 已实现(initStore/initStoreSync + .gitkeep) | 0f758a3 |
| D4 两层 store 目录 + 迁移 | ✅ 已实现+测试绿+真实数据已迁移 | 0f758a3(代码) + 迁移脚本 |

**D4 实施记录 (2026-06-10, 单独 /goal 收口)**:
- 布局 `stores/<group>/<label>/`:group(personal/team)由 `personal:true` 派生,label=`mount_name`(remote 派生 repo 名,无 remote 退 alias/UUID 短码)。真身份仍 store_uuid,查找经 config 记录走 UUID,改名/换 remote 只让标签旧。
- `storeRelativePathForMount` 改两层 + 新增 `storeMountGroup`/`storeMountSubPath`/`deriveMountLabel`;全部 consumer(shared/cli/server)适配;by-alias 软链改两层子路径;install/clone/create 处用 deriveMountLabel 赋 label。
- 迁移脚本 `scripts/migrate-two-layer-stores.mjs`:cp -r 备份 → temp 中转(旧单层目录名与新 group 桶名冲突)→ 移到两层 → 更新 config mount_name → 重建 by-alias。沙盒验证后跑真实 `~/.fabric`(备份 `~/.fabric.bak-2026-06-10T06-31-21-864Z`):personal→`stores/personal/fabric-store-personal-pcf`、team→`stores/team/fabric-team-knowledge`。
- `fabric doctor` 对迁移后真实 store 全绿(stable_id collision/counter drift/layer mismatch/underseeded 46 条/duplicate across trees 全 ok);唯 store_scope_lint 23 missing-scope 是 KP-DEC-9001 等 fixture 的 pre-existing 内容债(与布局无关)。
- shared 599 + server 691 测试全绿;cli 仅余 4 pre-existing(locale 耦合 + 缺 .fabric/AGENTS.md)。

**D5 备注**: 9000+ 里 `KT-DEC-0010(原9001 manual-rc3-fallback-test)` 与 `KT-PIT-0001(原9101 rc4-dogfood-orphan-demote-fixture)` 看着是测试夹具;本次非破坏式只换 id 保留内容,若要清掉这两个夹具是另一独立动作。

测试状态: shared/server 全绿;cli 仅余 pre-existing/flaky(store-command-surface ×2 真 pre-existing + ai-client-policy-drift/grouped-help/i18n/uninstall-integration 全 suite 并行 load 下 flaky、isolated 全过),均与本批改动无关。

## Risk Register

| # | Risk | 关联 | 严重度 | 缓解 |
|---|------|------|--------|------|
| R1 | D4 把语义(scope)轴重新焊回物理目录树,违背 store⊥scope 初衷;团队库里个人条目观感错位 | D4 | 中 | 用户明确权衡后接受;护栏限定"目录名=标签非身份";doctor 输出 store→remote |
| R2 | D2 删 enum 值为破坏性:既存 fabric-config.json 持 hybrid/match-existing 会 schema 失败 | D2 | 中 | pre-user 阶段可 clean-slate;或加一次性 lenient 迁移把旧值映射到 zh-CN/en |
| R3 | D5 push 重写远端 id,任何外部 cite 引用失效 | D5 | 低 | pre-user;失效可接受 |
| R4 | D4 目录迁移需搬运现有 `~/.fabric/stores/{personal,team}/` 实数据 + 更新 global.json 路径解析 + by-alias 软链 | D4 | 中 | 写迁移脚本 + doctor 兜底;改 store 路径解析处统一收口 |
| R5(旁路 bug) | Cursor 能力被低报(resolver `hook:false skill:false`),与 `reference_cursor_supports_skills` 矛盾 | 上轮 C2 | 低 | 非本轮 scope,记为待办 |

## Recommended Next Step

scope 已清晰,可直接进实现。建议顺序(按"风险低→高、独立→牵连广"):
1. **D5 团队库清理**(纯数据,独立,可先做先验证)
2. **D1/D1b/D2 全局语言统一 + 开局选择器 + enum 收窄**(同根,一起改;删 README 探测)
3. **D6 team store 项目选择交互**(install store stage 局部)
4. **D3 uninstall 重构**(独立 UI)
5. **D4b 预创建类目**(顺手)
6. **D4 两层 store 目录 + 迁移**(牵连最广:路径解析/global.json/by-alias/迁移脚本/doctor,放最后单独收口)
