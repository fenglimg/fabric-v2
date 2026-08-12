# spec/

只有 `guides/`(Trellis 自带的思维引导,真实内容)。**没有 per-package 的
`spec/<pkg>/backend|frontend/` 目录,这是有意的。**

## 为什么删了

`trellis install` 会为每个包铺开一套模板:`database-guidelines.md`、
`component-guidelines.md`、`hook-guidelines.md`、`state-management.md`、
`type-safety.md`、`error-handling.md`、`logging-guidelines.md`、
`quality-guidelines.md`、`directory-structure.md` + 两个 `index.md`。

2026-08-12 实测:39 个文件、13 份不同内容各复制 3 遍逐字节相同、**全部是
未填写的空壳**(通篇 `(To be filled by the team)`,index 的状态栏全是 `To fill`,
连 `directory-structure.md` 里的目录树也是 `<!-- Replace with your actual
structure -->` 占位)。而且模板描述的东西本项目没有:

- `database-guidelines.md` —— 全仓**零数据库依赖**
- `component-guidelines.md` / `hook-guidelines.md` / `state-management.md`
  —— 全仓 **0 个 `.tsx`**;`fabric-shared` 是纯库,没有 frontend

一个空模板对 AI 是**净负担**:它读到「这里有一份 component guidelines」,
会以为本项目有组件规范,实际什么都没有 —— 比没有这个文件更糟。

## 想加 spec 的话

先问一句:这条信息代码里有没有?代码形状读不读得出来?两条都满足就别写文档
(见 `KT-GLD-0021`)。本项目的真实架构与运行时契约在
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 与
[docs/RUNTIME-CONTRACTS.md](../../docs/RUNTIME-CONTRACTS.md),要写先查重,
别造第三份真相。

**不要为了让 `Spec indexes: N available` 这个数字变大而把模板填回来。**
