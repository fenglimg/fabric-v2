# Round 2 addendum — mem0 / GitNexus / Obsidian

**Date**: 2026-07-12  
**Parent**: ANL-same-space-frameworks-2026-07-12  
**Clones**: `tmp/mem0`, `tmp/GitNexus`, `tmp/obsidian-api`, `tmp/obsidian-releases`  
**Note**: Obsidian **core is not open source**; studied via product model + public API/releases repos.

## One-line each

| Peer | Layer | vs Fabric |
|------|-------|-----------|
| **mem0** | Personalized agent memory (user / session / agent) | **Evidence-ish false friend** — auto-extracted chat facts, not reviewed team norms |
| **GitNexus** | Code knowledge graph + impact MCP | **Explicit non-goal** — reinforces KT-DEC-0068 (no code KG cargo-cult) |
| **Obsidian** | Local-first personal knowledge vault (md + links) | **UX cousin** for local markdown graph; not team pending→review lifecycle |

---

## mem0 (https://github.com/mem0ai/mem0)

### What it is
「Memory layer for personalized AI」：让助手记住用户偏好与会话事实。SDK + self-host + cloud。

### Key mechanisms
- **Multi-level memory**: User / Session / Agent  
- **ADD-only extraction**（新算法）：一次 LLM 提取，不默认 UPDATE/DELETE 覆盖  
- **Multi-signal retrieval**: semantic + BM25 + entity，再融合（与 Fabric hybrid 方向同族）  
- **Temporal ranking**  
- CLI：`mem0 add` / `search`；agent 可 `mem0 init --agent`  
- Skills 教 agent 如何接入 Mem0  

### Steal?
| Idea | Verdict |
|------|---------|
| Hybrid multi-signal retrieval | **Info only** — Fabric 已在 BM25+vector/RRF 路上（KT-DEC-0064/0067） |
| User vs session vs agent scopes | 可对照 Fabric personal/team/project，但 **语义不同**（对话记忆 ≠ 审过知识） |
| Auto extract from chat | **不抄进 canonical** — 违 pending→review；最多像 personal scratch/evidence |

### Don't
- 把 mem0 当 Fabric 核心  
- 自动把对话事实 promote 成 team decision/pitfall  

**Closest prior**: sivtr evidence memory — 已归档「what happened ≠ what to remember」。

---

## GitNexus (https://github.com/abhigyanpatwari/GitNexus)

### What it is
「Nervous system for agent context」：把代码库索引成 **knowledge graph**（符号、调用链、流程），经 **MCP** 给 agent 用。

### Key mechanisms
- `gitnexus analyze` → LadybugDB graph under `.gitnexus/`  
- MCP：`query` / `context` / `impact` / `detect_changes` / `rename` / `trace`…  
- Agent 纪律：**改符号前必须 impact**；commit 前 `detect_changes`  
- 15-phase ingestion DAG；group-aware 跨仓 impact  
- License：**PolyForm Noncommercial**（注意商用）  

### Steal?
| Idea | Verdict |
|------|---------|
| impact-before-edit process skill | **可放 Maestro/外部 skill**，不进 Fabric 知识引擎 |
| detect_changes before commit | 过程技能，非知识 store |
| Hybrid search over graph | 再次验证 hybrid；**不是**要上代码 KG |

### Don't
- 在 Fabric 内建代码符号 KG / callers-callees（roadmap + **KT-DEC-0068** 已否）  
- 把 Fabric 召回改成「代码神经」  

---

## Obsidian (https://obsidian.md/)

### What it is
本地优先笔记应用：纯 markdown vault + **双向链接图** + 插件生态。**核心闭源**；`obsidian-api` / `obsidian-releases` 开源的是类型与插件目录。

### Key mechanisms（产品层）
- Local-first `.md` 文件 = 真源（与 Fabric git markdown store 同族味道）  
- Wiki-link / graph 导航（人脑关联，非 LLM 自动 cite）  
- MetadataCache：标题、链接、标签、块引用  
- 插件扩展；社区插件市场  

### Steal?
| Idea | Verdict |
|------|---------|
| Local markdown as source of truth | **已做**（store 里 md） |
| Link graph for navigation | **部分已有** `related[]` + fabric-connect；别做成完整 PKM UI |
| Human-curated notes + optional AI | 强化 **人审** 叙事，不是自动记忆 |
| Personal vault vs team vault | 对照 personal/team store 隐私轴 |

### Don't
- 做 Obsidian 克隆 UI  
- 用 vault 插件模型替代 MCP+hooks 客户端策略  

---

## Updated layer map (full set)

```
curated team knowledge     → Fabric
planning stores / SDD      → OpenSpec Stores, Spex, Spec Kit
process skills             → Superpowers
in-repo eng memory/tasks   → Trellis
document RAG               → EagleRAG
conversational memory      → mem0  (≈ evidence / personalization)
code knowledge graph       → GitNexus  (explicit non-goal)
personal PKM vault         → Obsidian (UX cousin only)
```

## Ranked impact on prior recommendations

1. **R1–R3 不变**（using-fabric / altitude / OpenSpec store UX）仍是最高价值  
2. **新增 hard non-goals**：mem0 自动记忆、GitNexus 代码 KG、Obsidian 全 UI  
3. **R10 info**：mem0 multi-signal 验证 Fabric hybrid 方向，不新开产品面  
4. **R9 optional**：Obsidian 式 graph 只加强 `related`/wiki-connect 体验，不改主循环  

## Go/No-Go (round 2)

| Peer | Morph into Fabric? | Micro-transfer? |
|------|--------------------|-----------------|
| mem0 | **No-Go** | retrieval fusion validation only |
| GitNexus | **No-Go** | process skill outside Fabric |
| Obsidian | **No-Go** | local-md + link graph UX polish only |

**Overall**：三方都 **加强**「Fabric 别变成 memory/RAG/code-graph 全家桶」的结论；**不改变** micro-transfer 主推荐。
