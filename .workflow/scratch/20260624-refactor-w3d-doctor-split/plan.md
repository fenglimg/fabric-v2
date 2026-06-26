# W3-D 重构方案 — doctor 八合一拆分 + 新 audit 组

> 权威 spec: `.workflow/.maestro/20260623-fabric-ux-census/gap-census.md` §2 row W3-D + grill GRL-001
> 分支: `feat/w3d-doctor-split`(已从含 flaky 修复的 main 切出)

## 现状(`packages/cli/src/commands/doctor.ts` 1689 行,九臂 dispatch)

`fabric doctor` 一个命令塞了 9 条执行臂 + 14 个隐藏 flag:
1. `--debug-bundle`(只读 bug 包)
2. `--history <archive|fix|all>`(只读历史)
3. `--archive-history`(只读,legacy,被 --history archive 取代)
4. `--enrich-descriptions [--auto --dry-run]`(描述回填)
5. `--cite-coverage [--since --client --layer]`(cite 覆盖率)
6. `--lint-conflicts [--deep]`(知识冲突)
7. `--fix-knowledge [--yes --dry-run]`(知识 frontmatter mutation + git mv,带 confirm 门)
8. `--fix [--dry-run]`(派生态 mutation: agents.meta 等)
9. 默认(只读健康报告)

`metrics` 已是独立顶层命令(`metrics.ts`)。`retired-references-lint`(server `doctor-retired-references-lint.ts`)目前折在 doctor 检查套件里,无独立 CLI surface。

## 目标终态

**`fabric doctor`** = 只做「健康体检 + 修」:
- 默认 = 健康报告(保留)
- `--fix` = 合并原 `--fix` + `--fix-knowledge`(派生态修 + 知识 mutation,保留知识 mutation 的 confirm 安全门 + KT-PIT-0016 诚实性:只预览真会执行的)
- 保留 `--json` `--verbose` `--strict` `--target` `--dry-run` `--debug-bundle`(健康域工具)
- 统一 `all/both` → `all`(cite-coverage 的 layer 已是 all;清掉任何 both 词汇残留)

**新 `fabric audit <sub>`** 组(遥测/审计域,镜像 store.ts 的 subCommands 模式):
- `audit cite`     ← 原 `doctor --cite-coverage`(带 --since/--client/--layer)
- `audit conflicts`← 原 `doctor --lint-conflicts`(带 --deep)
- `audit history`  ← 原 `doctor --history`/`--archive-history`(带 --since,mode archive|fix|all)
- `audit descriptions` ← 原 `doctor --enrich-descriptions`(带 --auto/--dry-run)
- `audit metrics`  ← 原顶层 `fabric metrics`(--json/--since)
- `audit retired`  ← 新薄 surface,独立暴露 retired-references-lint 报告

## migrate-before-delete(§1 纪律)

旧入口先迁调用点 → 验证行为一致 → 旧 flag 登记进 retired-reference registry(CI lint 拦残留)→ 再删。
调用点清单(grep 实证):
- `fabric doctor --cite-coverage`: `templates/skills/fabric-review/ref/cite-contract.md:3,45`(+ dogfood `.claude/` 副本)→ 改 `fabric audit cite`
- `fabric doctor --fix-knowledge`: `docs/USER-QUICKSTART.md:40,70` → 改 `fabric doctor --fix`(合并后)
- `fabric doctor --cite-coverage` 提及串: `templates/hooks/cite-policy-evict.cjs:388`(注:该文件 W3-I 将删,本轮仅同步串)
- `fabric metrics`: 无外部调用点;保留顶层 `metrics` 作 thin alias 指向 `audit metrics`(零迁移)还是直接迁——**OQ: 倾向保留 alias 一版**

## 任务分解(TDD,每步 tsc+vitest)

- TASK-001: 新建 `packages/cli/src/commands/audit.ts`(subCommands 组),迁 6 个臂的 dispatch + renderer(从 doctor.ts 搬纯函数,行为字节一致)
- TASK-002: `index.ts` 注册 `audit`;`metrics` 改 thin alias(或迁)
- TASK-003: 瘦身 `doctor.ts` — 删 6 臂,合并 `--fix`+`--fix-knowledge` 为单 `--fix`(保 confirm 门 + 诚实性),清 all/both→all,收敛 EXPOSED/HIDDEN flag 集
- TASK-004: i18n — 新增 `cli.audit.*` keys,清理迁走的 `cli.doctor.args.*`;locale-parity 绿
- TASK-005: migrate 调用点(cite-contract.md / USER-QUICKSTART.md / cite-policy-evict 串)+ 登记旧 flag 进 retired-reference registry
- TASK-006: `fabric install --yes` 同步 dogfood;全量 tsc + vitest;snapshot 更新;LEFTHOOK=0 commit → PR

## 风险

- **R1(高)**: 合并 `--fix`+`--fix-knowledge` —— 二者原有 deliberate mutex + 不同安全语义(知识 mutation 带 confirm 门)。合并须保: 派生态修无 prompt + 知识 mutation 仍 confirm(--yes/FABRIC_NONINTERACTIVE 旁路)+ 只预览真执行项(KT-PIT-0016 诚实铁律)。
- **R2(中)**: doctor.ts 1689 行搬迁,renderer 纯函数须字节一致(现有 snapshot 测试守);搬错破坏 doctor-reskin.test snapshot。
- **R3(低)**: retired-reference registry 接线 —— 旧 flag 名登记后 lint 要真能拦(producer-consumer round-trip 验,KT-PIT-0014)。
