# W3-C Refactor — reflection log

> skill 8→2 real + 2 shim + 0 router。分支 `feat/w3c-skill-collapse`。grill D3/D4 锁定,无 open Q。

## T1 — archive + source mode(吸收 import)
- git mv import 的 source 专属 ref(mining/dedup/checkpoint/state-recovery/output-contract/worked-examples)→ archive/ref/source-*.md;丢 import 的 i18n-policy(archive 有自己的)。
- archive SKILL 加 "Source Mode" 段(navigator-stub):GATHER 改从 git+docs 取候选,REVIEW+PERSIST 管道复用;锁 source-mode 契约(broad+[])。frontmatter 加 fab_archive_scan/fab_review + 吸收 import 触发词。
- **producer-consumer 标签契约**:source_sessions label `fabric-import-<date>` → `fabric-archive-source-<date>`(archive 发、review 按此前缀检测 import-origin,两端必须一致)。

## T2 — review + retire(audit)+ relate(connect)
- retire/relate 都是对 canonical 操作 → 折成 maintain 模式下的子流程(尊重 review 2-mode 设计)。
- 新建 review/ref/retire-mode.md(audit deprecate-over-delete + rescue-before-delete,引擎仍 doctor)+ relate-mode.md(connect related 边,复用 fab_review modify,零新写面)。
- review SKILL:mode 推断表加 retire/relate 关键词路由 + maintain 子流程导航桩 + frontmatter 加 fab_recall。

## T3 — store/sync thin shim
- 削成意图→CLI 路由表 + 极简红线,剥 i18n policy/冗余 precondition/重触发词。store 路由表同步 W3-E(mount/migrate/switch-write --scope)。

## T4/T5 — 删 4 skill + install 重写
- git rm fabric(router)/connect/import/audit 目录。
- install `skills-and-hooks.ts`(data-driven specs,比预想干净):删 4 spec + destinations + router-intent 重生机器(buildRouterSkillSource 等)+ 4 install fn;加 4 删除 dir 进 DEPRECATED_SKILL_DIRS(现存安装清理)。
- 3 个 install driver(orchestrator/pipeline.hooks.stage/commands.install)去 import/call。uninstall 的 4 个 legacy 移除器改 inline 字面路径(保留清旧)。
- 删 router-chain lint(doctor-skill-lints inspectRouterChainRef + ROUTER_VALID_LEAF_SLUGS + doctor.ts 接线 + i18n keys + test);FABRIC_SKILL_SLUGS 去 import。

## T6 — store 破坏性操作 CLI confirm 门
- 共享 `runGatedMigrate`:preflight DRY 算真 change count → 0 跳过(no-op 不问)→ confirm → apply。镜像 doctor --fix consent + KT-PIT-0016 诚实(只预览真执行的)。非 TTY 无 --yes/FABRIC_NONINTERACTIVE 拒绝。wire 进 migrate scope/promote/backfill + 加 --yes flag。

## T7 — migrate-before-delete
- bootstrap-canonical Skills (7)→(4) zh+en;lib/shared-policy.md 引用更新。
- **两个 hook 的 import 推荐(live pointer)**:broad banner(banner-i18n importCta)+ fabric-hint Stop-hook recommended_skill,`/fabric-import` → `/fabric-archive` source mode。
- doctor user-facing actionHints(i18n ×4 keys):fabric-import→archive source / fabric-audit→review retire。
- **决策**:不在 RETIRED_TOKENS 登记 skill 名(provenance/历史提及非 live pointer,避免误报税;skill 移除已由 install DEPRECATED + doctor-skill-lints 强制)。

## T8 — 验证
- tsc 0;shared 625✓ / server 775✓ / cli 1139✓。
- dogfood round-trip:`fabric install --yes` → `.claude/skills` 收敛为 archive/review/store/sync + lib(router/import/audit/connect 被 DEPRECATED 清掉);`audit retired` 116 surface 零残留;bootstrap = Skills (4)。

## Key learnings
- **同词跨语义复用查历史断言**:`migrate`(W3-E 已撞过)、`router-chain lint`(router 删后死代码 + 一条 not.toContain 断言)、doctor check 数量(44→43)、check-name 有序清单 —— 删一条 lint 牵动 snapshot + count + 有序 list 三处断言。
- **删 skill 的 migrate-before-delete 比删命令更广**:不只 bootstrap,还有两个 hook 的运行时推荐(banner + recommended_skill)+ doctor actionHints + skill-lint 期望集 + 6 个测试文件的期望计数/集合 + parity-matrix.json 能力行。producer-consumer 串(source_sessions label archive↔review)是隐藏的功能契约。
- **install 是 data-driven specs(FABRIC_SKILL_INSTALL_SPECS + DEPRECATED_SKILL_DIRS)**,R1 高风险被结构降级:删 skill = 删 spec + 加 deprecated dir,清理机制现成。
