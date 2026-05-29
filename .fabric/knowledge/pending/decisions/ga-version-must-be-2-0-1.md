---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-29T05:16:14.906Z
source_sessions: ["3ac70b48-e00f-404b-95cd-00d87ddd404f"]
proposed_reason: decision-confirmation
summary: "用户在 grill-me 收尾历史 rc 时确认 GA 版本号约束:裸 2.0.0 已于 2026-05-13 误发布到 npm(cli/server/shared 三包),距今 >72h 超 unpublish 窗,版本号被烧;v2.0.0 GA 必须发 2.0.1。npm latest 仍指 1.7.0、rc 链挂 next dist-tag,RC 阶段不动,留到 GA 统一改(移 latest + 改 6 处 docs @latest + deprecate 孤儿 2.0.0)。"
tags: ["release", "npm", "versioning", "ga"]
relevance_scope: broad
impact: ["GA 若直接 npm publish 2.0.0 会因版本已存在而失败", "用户裸 npm install 仍装到 v1.x 直到 GA 移 latest"]
must_read_if: "规划 v2.0.0 GA 发版 / 版本号决策 / 把 latest dist-tag 移出 1.7.0 时"
x-fabric-idempotency-key: sha256:6e5d7074354f7e6eae0f434dfcc867212492df2eca1ce57618901e9023f726ca
---

## Summary

用户在 grill-me 收尾历史 rc 时确认 GA 版本号约束:裸 2.0.0 已于 2026-05-13 误发布到 npm(cli/server/shared 三包),距今 >72h 超 unpublish 窗,版本号被烧;v2.0.0 GA 必须发 2.0.1。npm latest 仍指 1.7.0、rc 链挂 next dist-tag,RC 阶段不动,留到 GA 统一改(移 latest + 改 6 处 docs @latest + deprecate 孤儿 2.0.0)。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: 两轮 grill-me 评测 rc.39 范围 + 收尾历史 rc 遗留。Turning point: 实测 npm 发现 dist-tags latest=1.7.0 / next=rc.38, 且存在 2026-05-13 误发的孤儿 2.0.0, 推翻旧 memory "2.0.0 从未发布"。Result: GA 不能用 2.0.0(已占且过 unpublish 窗), 锁定 GA=2.0.1; L1/L2 全 defer 到 GA 统一处理。

## Evidence

Recent paths:

- package.json
- packages/cli/package.json
- packages/server/package.json
- packages/shared/package.json

Notes:

- 用户在 grill-me 收尾历史 rc 时确认 GA 版本号约束:裸 2.0.0 已于 2026-05-13 误发布到 npm(cli/server/shared 三包),距今 >72h 超 unpublish 窗,版本号被烧;v2.0.0 GA 必须发 2.0.1。npm latest 仍指 1.7.0、rc 链挂 next dist-tag,RC 阶段不动,留到 GA 统一改(移 latest + 改 6 处 docs @latest + deprecate 孤儿 2.0.0)。
