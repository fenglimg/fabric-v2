---
id: KT-DEC-0003
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [storage-layout, gitignore]
---

# Dual-root layout: ~/.fabric + <repo>/.fabric

## Decision

将 personal 与 team 两类 knowledge 切分到两个物理 root：
- Team：`<repo>/.fabric/knowledge/` —— 提交进 git，与协作者共享。
- Personal：`~/.fabric/knowledge/` —— 永不提交，只存在于本机。

两个 root 共用同一套 6 子目录布局：decisions、pitfalls、guidelines、
models、processes、pending。

## Alternatives considered

- **Single root with per-file gitignore**：用单一 `.fabric/knowledge/`，
  通过 `.gitignore` 规则按 frontmatter 的字段过滤掉 personal 条目。
  否决：gitignore 只识别路径，无法读取 frontmatter。
- **Single root with name convention**：personal 文件统一加 `personal-*.md`
  前缀。否决：太脆弱，一次手滑就会把 personal 文件提交上去。

## Rationale

物理隔离是唯一能可靠阻止 personal 条目泄漏到 git 提交的方式。Dual-root
设计让边界由机器强制执行，而不是依赖团队约定。

## Tradeoffs

Doctor 必须独立检查两个 root；`fab init` 需要同时创建两个；init-scan
只写入 team root。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot，Q7（dual-root
layout 已确认为强制要求）。
