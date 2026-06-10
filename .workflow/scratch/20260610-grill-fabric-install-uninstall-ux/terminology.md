# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| client / 客户端 | Fabric 接入的 AI 工具,各有 bootstrap/mcp/hook/skill 能力面 | `config/resolver.ts:detectClientSupports` | locked |
| ClientKind | 客户端类型枚举 union,决定可建 writer | `config/writer.ts:1` | locked |
| Codex Desktop | 用户实测支持 MCP 的客户端,**代码尚未实现 writer**(本轮新增目标) | 无(待建) | open(待建) |
| Cursor | 已实现客户端(bootstrap+mcp),capability flag 误标 skill/hook=false | `config/resolver.ts:127`, `json.ts:359` | locked(修flag) |
| personal store | 跨机可携的个人知识 store,无 personal 时当前静默新建本地 | `store.stage.ts:265 ensurePersonalStore` | locked |
| team store | 共享知识 store,已有 join(clone)/create 范式 | `store.stage.ts:209 promptStoreOnboarding` | locked |
| clone-or-new | store onboarding 二选一:从 remote clone 已有 / 新建 | `store.stage.ts:215-252` | locked |
| semantic search / 语义搜索 | 向量召回,opt-in,需 fastembed + 模型权重 | `install/semantic-search.ts` | locked |
| fastembed | 可选 embedder npm 包,需装到 MCP server 解析模块位置 | `semantic-search.ts:79` | locked |
| t() / i18n | locale 路由翻译函数;部分 prompt 绕过它硬编码 | `cli/src/i18n.ts`, `shared/src/i18n/locales/` | locked |
| gloss | 受保护英文术语首现的括号中文注释策略 | (本轮新增策略) | locked |
| stage / phase | install/uninstall 的执行阶段(scaffold/bootstrap/mcp 等) | `uninstall.ts:280`, `install-stage-output.ts` | locked |
| bootstrap | 把 AGENTS.md 策略 block 同步进客户端 managed block | resolver capabilities.bootstrap | locked |
