# Fabric Bug Audit — goal-checklist (mode② 审计驱动)

> status.json 是真源,本文件是投影视图。Resume → 调 `/goal-mode continue`。

## 目标
oracle-driven 发现 Fabric 所有功能不一致(没完成/不达预期/前后矛盾)+实际 bug,loop-until-dry。
本轮 = **集成验证 proof**:证明发现链 `oracle-catalog → discover → §5 verify → findings[]` 在真实代码库通畅。

## 边界契约
- in: packages/{cli,server,shared}/src + packages/cli/templates
- out: node_modules / coverage / 已知设计意图(NEW-N-1 无push / KT-DEC-0002 无v1迁移 / hidden 命令)
- 铁律: finding 上报前 grep 实证(防 reimplemented-noop)

## 执行准则(发现原语)
每轮取 `bug-oracle-catalog.md` 一条 dimension → 广度发现(manage-issue-discover by-prompt,**禁 8-perspective**) →
§5 verify 阶梯(deterministic 先验) → confirmed 进 findings[] → spawn 修复 task。

## Round-1 结果 ✅
- [x] declared-vs-impl(命令): 12/12 OK → clean
- [x] declared-vs-impl(MCP tool): 6==test → clean
- [x] doc-vs-code(KT-DEC-0007 hook block): **F1 confirmed (high)** → needs_adjudication(drift vs bug)

## 待跑 oracle(续审则 continue)
- [ ] producer-consumer: event_type emit 字段 vs hook/doctor reader
- [ ] invariant: install 幂等 / counter 单调永不复用 / retire→recall round-trip
- [ ] doc-vs-code: KT-DEC-0003 personal-no-commit / no-server-side-filter 承诺

## 待裁决队列
- **F1**: fabric-hint Stop hook `decision:block` 强制续跑 vs KT-DEC-0007 "永不阻塞" — 设计漂移(更新KB)还是 over-block bug(改 exit2+stderr)? 撞 NEW-N-4 红线。需 human 拍。
