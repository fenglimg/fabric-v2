# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| **Machine 层** | 机器/账号级配置家，一台机一份 | `~/.fabric/fabric-global.json` → `globalConfigSchema` (schemas/store.ts:340) | locked |
| **Store 层** | 随知识库 git 分发的配置家；personal/team 同构，`personal:true` 仅为 flag。今仅装 identity，目标扩为携带"共享语料行为默认" | `store.json` → `storeIdentitySchema` (schemas/store.ts:54)；isomorphic layout S42 | locked |
| **Repo 层** | 本代码库级配置家，per-repo；装本地工作流 + store 绑定 + store 层旋钮的可选覆盖 | `<repo>/.fabric/fabric-config.json` → `fabricConfigSchema` (schemas/fabric-config.ts:158) | locked |
| **覆盖机制（env·local）** | 横切三家的临时压制手段，非独立层；无专属旋钮 | 现有零散 env（FABRIC_HOME/FAB_LANG…）+ 未来可选 `.fabric/fabric-config.local.json`（gitignored，未实现） | locked |
| **共享语料旋钮** | 决定共享知识如何排序/浮现/维护的旋钮；必须有 Store 层默认才能保团队一致 | embed_model / broad_index_backstop / fusion / recall_relevance_ratio / plan_context_top_k / credibility_* / orphan_demote_* (fabric-config.ts) | locked |
| **向量配方** | 控制 dense-embedding 召回的 4 旋钮 | `embed_enabled` / `embed_weight` / `embed_model` / `fusion` (fabric-config.ts:545-585) | locked |
| **canonical home（唯一默认家）** | 每个旋钮存放默认值的唯一层；其他层只能显式覆盖（C-006 防打架） | 设计约束，无单一代码点 | locked |
| **团队一致性 gap** | 行为旋钮住 per-repo project 配置、不随 store 走 → 团队分发后各成员召回行为发散的结构性缺口 | store.json 零行为旋钮 + broad_index_backstop 读 project (knowledge-hint-broad.cjs:311) | locked |
| **远程嵌入双模** | 嵌入既支持本地 fastembed 也支持远程 API；model 身份归 Store、endpoint+key 归 Machine | 现 vector-retrieval.ts 纯本地 fastembed，远程未实现 | open（blueprint 落地） |
| **degrade-to-text（缺 key 降级）** | 成员缺远程 key 时关向量通道走纯 BM25 文本，不静默换本地模型（保语义空间一致） | 设计决策 D6，扩 KT-MOD-0003 degrade-safe | locked |
| **doctor 软告警** | repo 覆盖 store 层旋钮时非阻断地提示"与队友不一致"，以可见性软约束替代硬锁 | 设计决策 D3，新 doctor lint（未实现） | open（blueprint 落地） |
