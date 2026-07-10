# rc.35 W6 Closure 工具集

按顺序执行:

## 1. Push 13 commits → main (CI 验证)

```bash
cd /Users/wepie/Desktop/personal-projects/pcf
git push origin main
```

CI 跑 typecheck + tests + lint。等 CI ✅ 再进 step 2。

## 2. Dogfood 真升级 (用户主导)

需要本地有 werewolf 项目 + 当前全局 `fabric` 是 rc.30 (本机已确认)。

```bash
cd /Users/wepie/Desktop/personal-projects/pcf
# 改 WEREWOLF_REPO env 指向你的 werewolf 仓库根目录
WEREWOLF_REPO=/path/to/werewolf-minigame bash .workflow/.scratchpad/rc35-closure/dogfood-script.sh
```

Evidence 落到 `.workflow/.scratchpad/rc35-closure/evidence/`。

## 3. Gemini batch review (一次)

复制 `gemini-review-prompt.md` 里的 maestro delegate 命令到 shell 跑。

## 4. CHANGELOG 闭口

把 `CHANGELOG-rc35-draft.md` 内容替换 `CHANGELOG.md` 当前 rc.35 entry 的精简版,
然后 commit。

## 5. Release

跑 `/release-rc` skill (或手动 bump version + tag + push)。

---

## 防漏检查清单

- [ ] CI 双绿 (typecheck + tests)
- [ ] dogfood 5 phase 全部 ✓ (尤其 P0-9 hooks_wired + P0-14 doctor 不再 dump JSON)
- [ ] Gemini SHIP / CONDITIONAL 已修
- [ ] CHANGELOG.md 替换为完整版
- [ ] CHANGELOG rc.34 stamp 已是 `2026-05-26` (W1 TASK-02 已做)
- [ ] `git tag v2.0.0-rc.35`
- [ ] `git push origin v2.0.0-rc.35`
- [ ] GitHub Release workflow ✅
- [ ] npm published clean

---

## 当前未推送状态

```text
$ git log --oneline -13
b63781f W5 TASK-12 audience tag + fold
9a41704 W5 TASK-11 AGENTS.md For Developers
fad1571 W5 TASK-10 USER-QUICKSTART.md
e992d78 W4 TASK-09 doctor 人话化 ZodError
b968e12 W4 TASK-08 --force-skills-only
7cf2914 W3 TASK-07 cite infrastructure
937453e W2 TASK-06 hint renderer fallback
42e56f6 W2 TASK-05 knowledge_summary_opaque
c7ea963 W2 TASK-04 global_cli_outdated
5bf687d W1 TASK-04 (反向 sweep)
ac22f0c W1 TASK-03 deprecation cleanup
8dfc001 W1 TASK-02 CHANGELOG BREAKING
d1abc12 W1 TASK-01 fabric → fab (被反转)
```

Gates: cli 727 / server 643 / shared 430 / typecheck 0 — 全绿。
