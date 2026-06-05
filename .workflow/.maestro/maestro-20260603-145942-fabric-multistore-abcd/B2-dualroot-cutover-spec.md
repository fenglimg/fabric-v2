# B2 全砍 dual-root — 分阶段迁移 spec

> 用户决策 (2026-06-03): **全砍**(Option A)。本 spec 是安全执行顺序 —— 不孤儿化数据、不半截、每阶段独立 commit + 测试绿。
> 风险底线: pcf 自身有 **22 条 committed 项目本地知识**, 20 个测试文件断言 dual-root 路径。无迁移工具直接砍 = 数据丢失。

## 终态
知识只住在 store 里。写侧无 dual-root fallback;无 store 可写时友好硬失败 + 引导, 不再静默落项目本地 / `~/.fabric/knowledge`。

## 阶段(严格按序, 各自 commit)

### Stage 1 — 地基: install 保证 store + 迁移工具(先建安全网)
- **1a** per-repo `fabric install`: 若无 global config / personal store → 自动 mint(或引导 `install --global`), 保证写目标恒可解析。
- **1b** 新增 `fabric store migrate`(或 install 内自动): 把项目本地 `.fabric/knowledge/**`(含 pending)搬进 active write store(team scope)/ personal store(personal scope), 处理 stable_id per-store 重映射 + git。dry-run 预览必备。
- **验证**: 迁移 pcf 自身 22 条到一个 store, recall 仍命中;迁移幂等;dry-run 不写。

### Stage 2 — 翻写: 写侧 store-only
- `pendingBase` / `resolveStoreCanonicalBase` 移除 dual-root fallback(extract-knowledge.ts + review.ts)。
- 无 store target → 抛 actionable FabricError(引导 `install --global` + `store bind`), 非静默回退。
- **验证**: 有 store → 写进 store;无 store → 友好硬失败(非 stack)。

### Stage 3 — 收尾
- 重写 ~20 个测试文件的 dual-root 路径断言 → store 路径 / 硬失败断言。
- 删 `~/.fabric/knowledge`(空)+ 停止任何创建它的代码路径(install/scaffold)。
- C2(pending 归位 store 内)随 Stage 2 自然达成。

## 关联决策(用户「按推荐」已定)
- **C1 project 分层**: **不建独立 per-project store 档**。scope 词表保留 `project:` 接口(留扩展), resolution 仍 personal+team。真正多-project 库属 northstar 后续, 不在全砍内。→ 标记 decided=defer。
- **C3 库名可读层**: **保 UUID 物理目录不变**, 加 `~/.fabric/stores/by-alias/<alias> → <uuid>` symlink + CLI 显示。纯增量不破坏现有挂载。可独立于全砍随时做。
- **F4**: 已修(c4c2002)。

## 为什么单列、不在本会话尾巴硬做
全砍 = 跨 ~3 commit 的迁移 + 20 测试重写 + 数据迁移工具, 需专注 + 新鲜上下文。本会话已交付 5 个干净 commit(A/B1/D1/F26/F4);把全砍塞进尾巴 = 半截迁移 + 丢数据风险, 违背 fix-don't-hide + 用户成本纪律。**建议: 新开专注会话执行本 spec。**
