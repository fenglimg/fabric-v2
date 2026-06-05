# Fabric 多 store 分层落地 — goal-checklist (A→B→C→D)

> **status.json 是真源,本文件是投影。** exec=internal(主线串行, 不让 Agent 编排替代实际工作)。
> Resume: 读本文件取「执行准则/边界/子目标」作行动手册, 然后调 `/maestro-ralph continue` 推进下一步。
> 完整问题溯源: `.workflow/.scratchpad/rc2-dogfood-experience-issues.md`。

## 终态
Fabric = 「个人/项目/团队」分层知识库:每个项目装好即被引导连上该连的库, 知识只住在库里(无旧 dual-root、无假"施工中"告示), 首次使用有 onboarding 带入门。

## 执行准则
1. 严格 A→B→C→D, 不跳波;A 与 B 同批(B 依赖 A)
2. 主线串行 Edit/Write/Bash 优先, 不 spawn Agent 替代实际工作
3. 每条改动先 grep 验证现状再改(防 noop / 重复实现)
4. 每 wave 末 typecheck + 相关 test 绿才收口 commit(先开 feature 分支, sha 回填 git_commits[])
5. behavior-preserving 用回归测试守, 新行为用新测试覆盖;改 shared schema 后 rebuild dist

## 边界
- **in**: packages/{cli,server,shared} 的 onboarding/拆围挡/补半层/修硬伤 + 对应单测
- **out**: 重写 5type/3maturity schema · org/联邦实现(留接口) · 向量 install onboarding · 不可逆破坏写

## 子目标(done_when 客观可校验)
- [x] **A · 装门铃**: install/doctor 引导 store bind+switch-write ✅ @42ab733 (26 测试绿 + tsc 绿)
- [~] **B · 拆围挡**: B1 删 experimental-unwired 三处+key+注释 ✅ @42ab733;**B2 砍 dual-root + B3 删空目录 → 🚩 ADJ-B2-DUALROOT(需用户裁决)**
- [ ] **C · 补半层**: resolver 解析 project:<id> 档进 readSet;pending 写入 store 内;库名加 alias 可读层(UUID 不变);test 绿
- [~] **D · 修硬伤+打磨**: D1 recall 孤儿条目跳过+warn 不崩 ✅ @dec6e01;剩余(cite 闭环 / whoami-storelist 口径 / sync 报错 / draft 空壳 / AGENTS.md 文案)待 steer
  - [x] D1 recall 守卫 (F7/F20) ✅
  - [ ] D-rest: cite 闭环 · whoami/store list 口径 (F4) · sync 报错 (F26) · draft 空壳 (F10) · 文案对齐

## 轮次日志
- **R1** (2026-06-03): Wave A 全做(install nudge + doctor unbound check + unboundAvailableStores + 5 测试)+ B1 删 F28 假告示(3 打印 + i18n key + 注释, 0 残留)。commit 42ab733。
- **R2** (2026-06-03): D1 recall store-qualified 孤儿 id 跳过+warn 不崩(F7/F20)— knowledge-sections skip 逻辑 + api-contract enum 扩 + RecallResult 类型 + 回归测试。15+34 测试绿, tsc 绿, snapshot 更新。commit dec6e01。
- **R3** (2026-06-03): D-F26 sync --continue/--abort 无 session 抛 FabricError + actionHint(不再吐 stack/路径)。+2 回归测试, 15 测试绿。commit 31be901。
- **R4** (2026-06-03): 用户裁决 B2=**全砍** + C1/C3/F4「按推荐」。落地 **D-F4**(whoami 口径对齐 store list 物理 git, c4c2002)。B2 全砍 立 `B2-dualroot-cutover-spec.md` 分阶段(地基迁移→翻写→收尾, 防孤儿化 pcf 22 条 + 20 测试重写)→ 属专门迁移工程, 不在本会话尾巴硬做。C1 decided=**defer**(不建 per-project store, 留 scope 接口)。C3=by-alias symlink 增量, 待做。
- **本会话产出**: 5 commit(42ab733 A+B1 / dec6e01 D1 / 31be901 F26 / c4c2002 F4)。全测试+tsc 绿, 各自独立。
- **未达 ALL_GOALS_DONE 之正当原因**: B2 全砍 = 跨会话迁移(已 spec); C3 + D-rest(draft 空壳 hint / AGENTS.md 文案 / cite 闭环验证)为带 ripple 的尾项。均不宜在已超长会话尾巴硬塞。**建议新开专注会话执行 B2 spec + 收尾。**

<!-- ALL_GOALS_DONE 哨兵:全部子目标 done 后由 post-goal-audit 写入。当前 BLOCKED on ADJ-B2-DUALROOT, 未达成。 -->
