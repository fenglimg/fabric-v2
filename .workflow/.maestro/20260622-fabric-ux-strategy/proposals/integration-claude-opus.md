# 集成视角提案 — claude 子代理(opus, 顶替认证失败的 claude delegate)

> Round 1 候选 · 集成视角 · vs 擂主 C0-grilled

## 0. 定调
Fabric 护城河 = MCP 跨客户端 + 多 store 物理隔离(maestro 没有,maestro 是单 workspace + 常驻 dashboard 后端)。集成 maestro 能力的唯一判据:**这条能力能不能在"无后端、纯 hook+MCP+markdown"形态里存活**。能→抄/改造抄;只能靠常驻 web 服务活→错战场不抄。54ca613 把 P2 押云 dashboard 正是踩 maestro 长板碰自己短板。

## 1. 集成路线图

### 本版(纯函数可移植,零新后端/存储)
| 能力 | 判定 | 价值/成本 | 证据 |
|---|---|---|---|
| BM25F 四字段加权检索 | 改造抄 | 高/低。FIELD_CONFIGS(title boost3 b0.3 / tags2 / summary1.5 / body1)契合 fabric frontmatter;落在 fab_recall 服务端,不依赖 dashboard,纯函数搬 searchBM25F | search.ts:29-48, :294-334 |
| CJK n-gram 分词 | 抄(逐字) | 高/极低。中文 KB 召回差是硬伤;2-3gram+latin remainder 纯函数 verbatim | search.ts:96-129 |
| credibility 衰减作检索乘子 | 改造抄(降级版) | 中高/中。doctor 现有 orphan_demote 是离散三态;maestro computeDecayFactor 是连续乘子进排序。**不引 sqlite**,改从 events.jsonl 算 age → recall 时算连续因子乘进 BM25。复用已有 events.jsonl 零新存储 | credibility.ts:78-87, :36-49; search.ts:283-289 |

### vNext(需新 schema/hook)
| 能力 | 判定 | 价值/成本 |
|---|---|---|
| knowhow 9 类型 → 收敛 2-3 类 | 改造抄(大幅砍) | 中/中。fabric 已有 5 类型,9 类过载=审核负担。只抄 recipe/template 维度(processes 支持可执行配方 Goal/Steps/Pitfalls) |
| spec-setup 7步 wizard → 冷启动扫描(砍到3步) | 改造抄 | 高/中。零用户最大痛点=空 KB 冷启动。抄 step2 manifest 扫描+step3 代码模式+step6 recipe 生成,接进现有 fabric-import skill |
| conflict/dedup semantic check | 保留+对齐(已有别重做) | 高/低。fabric 已有 doctor --lint-conflicts(bm25候选对+LLM judge),只需喂 BM25F 升级后的候选对 |

### 以后/不抄(错战场)
| 能力 | 判定 | 理由 |
|---|---|---|
| 7 视图 Web Dashboard | 不抄 | 典型错战场。maestro 有 7 视图因它本身是常驻后端(REST+WS+SSE);fabric MCP-first 零用户无后端。可视化应落 AI 终端内(HUD+progressive disclosure)不是浏览器 |
| sqlite credibility 表 | 不抄(只取算法不取存储) | 无后端引 sqlite=新依赖+新 drift。只抄 computeDecayFactor 纯函数,存储用 events.jsonl |
| L4 stress test | 改造抄但延后 | 54ca613 高估优先级:零用户无性能压力。本版 BM25F 落地后加一个 recall 基准即可 |
| L3 e2e(archive→review 全链路) | 抄(这条 54ca613 对了) | 高/中。archive→review→canonical 是核心资产确缺端到端回归。放 vNext,本版先修检索 |

## 2. 逐块裁决擂主
- **交互1 单 HUD**:强保留。对齐 design-research 核心句 + progressive disclosure。补强:HUD 带 credibility 信号,给久未命中旧 KB 视觉降权(epistemic UI)。
- **交互2 11→3**:保留+改进。Stage2 自动判重必须用升级后 BM25F+credibility 乘子,而非裸字符串;做成"BM25F 候选→仅 high overlap 才 LLM judge"省 token 又准。
- **交互3 nudge 搬 SessionStart**:**改进(不全推翻)**。响应式渐强对,但"全搬 SessionStart 过头"。应**双锚**:review backlog nudge 搬 SessionStart(开局状态盘点);archive cadence nudge 留 Stop(因"这批 edit 刚做完"信号只有 Stop 完整),但做成响应式渐强。全搬会让 archive 提示滞后一整个会话。
- **策略4 scope 5→3**:强保留。layer 硬边界守护城河;when(空/glob)对标 Cursor/Windsurf/Copilot 趋同。**提醒**:when 的 glob 直接采 Copilot applyTo / Cursor globs 写法别自创,自创=放弃"跨端"护城河一半。

## 3. 比 54ca613 更对(一句话)
54ca613 按"maestro 有什么我补什么"排(用 fabric 短板追 maestro 长板);本路线按"哪条能力能在 MCP-first 无后端形态无损存活"排——本版只搬纯函数(BM25F+CJK+衰减乘子复用 events.jsonl 零新存储),P0 stress 降级、P2 云 dashboard 判错战场剔除,每分成本都加固护城河而非稀释。
