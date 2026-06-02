# 方案 ③ — 向量检索:修中文模型 + 进 install 一键化

> 现状:`vector-retrieval.ts` 用 fastembed 默认模型 = `BAAI/bge-small-en-v1.5`(**英文**,384维);
> 而 Fabric 笔记大量中文(zh-CN-hybrid)→ 英文模型搜中文语义效果差。且默认 OFF、需手装、首跑联网下载。

## 两件事
### A. 修中文模型(选型)
fastembed-js 支持的多语言/中文向量模型候选(**需先确认 fastembed-js 实际支持列表 — 这是唯一研究依赖**):
- **`intfloat/multilingual-e5-large`**(fastembed-js 一般支持;多语言含中文强;~1GB)
- **`BAAI/bge-m3`**(多语言 SOTA;但 fastembed-js 是否支持需核实;较大)
- 轻量备选:中文小模型(若 fastembed-js 支持)
- 选型权衡:中文效果 × 体积/下载 × CPU 速度。**建议默认 multilingual-e5(若 fastembed-js 确认支持)**。

### B. 进 install 一键化
把"开向量"从"手动装+踩坑"变成 install 里一个可选步骤。

## 具体改动
| 文件 | 改动 |
|---|---|
| `packages/shared/src/schemas/fabric-config.ts` | 加 `embed_model`(默认 pin 多语言模型名),不再裸用 fastembed 默认英文。 |
| `packages/server/src/services/vector-retrieval.ts` | `FlagEmbedding.init({ model: config.embed_model, ... })` 读 config 模型(现在硬编码默认)。 |
| `packages/cli/src/commands/install.ts` | 加可选步骤:"启用语义搜索?"→ `npm i -g fastembed` + 预热模型缓存(`FABRIC_EMBED_CACHE_DIR`)+ 设 `embed_enabled:true` + 写 `embed_model`。默认仍 OFF(opt-in)。 |
| (可选)新 `fabric config embed` 子命令 | 装好后单独开/换模型,不必重装。 |

## 离线/隐私
- 保留现有 HONEST CAVEAT:首跑 cold-cache 会联网下载**模型权重**(不传 KB 数据)。
- install 步骤明确告知"会下载 ~XXX MB 模型,需联网一次";严格离线者预热 `FABRIC_EMBED_CACHE_DIR`。

## 风险 / 研究依赖
- **关键未知:fastembed-js 到底支持哪些中文/多语言模型** —— 实现前必须先核实(查 fastembed-js 的 EmbeddingModel 枚举)。若都不理想,可能要换 embedder(更大改动)→ 先研究再定。
- 模型体积/首跑下载时长的用户预期管理。
- embed_model 改了需重新 embed 已有库(向量维度/语义变)→ 加 reindex 流程或文档说明。

## 测试
- config embed_model 读取 + 传入 init 的单测(用 fake embedder,不真下模型)。
- install 可选步骤的幂等 + skip 路径测试。
- 中文 query→中文条目的语义召回回归(需真实模型,放 nightly/手动,不进 CI 默认)。

## 工作量估计
B(config+install 接线)中等且确定。A(中文模型)有**研究前置**(fastembed-js 支持列表),建议**先花半天调研选型**再落地,避免 pin 一个 fastembed-js 不支持的模型。
