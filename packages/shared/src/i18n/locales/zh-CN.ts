import type { Messages } from "../types.js";

export const zhCNMessages: Messages = {
  "cli.signpost.retired": "命令 `{retired}` 已移除。请改用 `{successor}`。",
  "cli.doctor.args.probe.description": "输出机器可读 JSON 就绪快照(first-hit + store/hooks),不跑 --fix",
  "cli.main.description":
    "Fabric CLI — 自动把本项目的决策 / 踩坑 / 规范喂给你的 AI 助手，让它不必每次会话重新学。首次使用?运行: fabric install",
  "cli.shared.created": "已创建",
  "cli.shared.skipped": "已跳过",
  "cli.shared.next": "下一步",
  "cli.shared.reason": "原因",
  "cli.shared.updated": "已更新",
  "cli.shared.missing": "缺失",
  "cli.shared.present": "存在",
  "cli.shared.absent": "缺失",
  "cli.shared.yes": "是",
  "cli.shared.no": "否",
  "cli.shared.none": "无",
  "cli.shared.loading": "加载中",
  "cli.shared.refresh": "刷新",

  // flat-design-system Wave4 (TASK-004): clack 控件（select/multiselect/confirm/text）
  // 落定后打印的平铺无沟槽 ✓/x 回执行。控件保持原生（C-006），回执是独立的一行。
  "cli.prompt.receipt.selected": "已选",
  "cli.prompt.receipt.set": "已设置",
  "cli.prompt.receipt.cancelled": "已取消",
  "cli.shared.target-invalid": "目标必须是已存在的目录：{target}",
  "cli.shared.target-invalid.action-hint":
    "请选择一个已存在的项目目录，或先创建该目录后再重新运行命令。",
  "cli.shared.template-not-found": "未找到模板：{path}",
  "cli.shared.invalid-host-empty": "无效 host：<empty>",
  "cli.shared.invalid-port": "无效端口：{value}",
  "cli.shared.error": "错误",

  // 顶层命令摘要(每条一句精简单行 —— citty 在根 `fabric --help` 的 COMMANDS
  // 表与各命令自身 `--help` 头部都用它,必须保持单行;退掉自建分组帮助、改走
  // citty 渲染器后,原先的多行示例块已移除)
  "cli.store.description": "管理已挂载的知识 store(建库走 fabric install)",
  "cli.sync.description": "同步已挂载的知识 store(pull --rebase + push)",
  "cli.info.description": "显示 Fabric 身份、项目状态与召回健康",
  "cli.inspect.description": "显示 Fabric 在 SessionStart 注入了什么",
  // `fabric inspect` 参数说明 + --explain 溯源覆盖层 + 错误。
  "cli.inspect.arg.render": "显示哪个 sink:'human'(systemMessage)或 'ai'(additionalContext)。默认两个都显示。",
  "cli.inspect.arg.explain": "追加逐条来源溯源段(id · type · maturity · scope · 浮现原因)。",
  "cli.inspect.arg.target": "覆盖项目根目录(默认取 cwd / dev 模式解析)。",
  "cli.inspect.explain.title": "explain · 来源溯源(非注入内容)",
  "cli.inspect.explain.always": "常驻生效 · 正文已注入",
  "cli.inspect.explain.reference": "参考候选 · 按需阅读",
  "cli.inspect.explain.census": "全集普查",
  "cli.inspect.explain.census-total": "总计 {total}",
  "cli.inspect.error": "inspect 失败:{message}",

  // `fabric preview` — 本地只读知识预览 web 服务(loopback-only)。
  "cli.preview.description": "启动本地只读知识预览页(浏览器里按受众分组浏览)",
  "cli.preview.arg.port": "监听端口(默认 7777)。",
  "cli.preview.arg.host": "监听地址(默认 127.0.0.1,仅本机可访问)。",
  "cli.preview.arg.open": "启动后自动打开浏览器(默认开;传 --no-open 关闭)。",
  "cli.preview.arg.target": "覆盖项目根目录(默认取 cwd)。",
  "cli.preview.arg.variant": "默认打开的样式变体(默认 lumen;全部风格见 /gallery)。",
  "cli.preview.gallery-hint": "所有样式画廊:{url}",
  "cli.preview.started": "知识预览已启动:{url}",
  "cli.preview.opening": "正在打开浏览器…",
  "cli.preview.stop-hint": "按 Ctrl-C 停止。",
  "cli.preview.stopped": "预览已停止。",
  "cli.preview.error": "preview 失败:{message}",
  "cli.audit.description": "知识与遥测审计 (cite/conflicts/history/metrics)",

  // `fabric audit cite` — recall 覆盖率为 0 的自诊断提示。
  "cli.audit.cite.recall-mismatch-hint":
    "recall 覆盖率为 0,但本窗口有 {recalls} 次 recall(分布在 {sessions} 个会话)—— 没有一个与编辑共享会话。常见原因:(1) fab_recall 漏传/传错 session_id(必须是真实客户端 session_id;planned 无 session 永不与 edit 关联);(2) recall 的 paths 与编辑文件无 path-overlap(自动 cite 只计重叠的 planned.target_paths)。修:传 session_id、重装 hooks 启用 active-session sidecar、或 fab_recall 覆盖将编辑的路径。见 AGENTS.md 与 docs/UPGRADE.md。",
  "cli.audit.cite.recall-none-hint":
    "recall 覆盖率为 0 —— 这些编辑前没有同会话的 fab_recall(或 planned 事件 session_id 为空导致无法关联)。改前先 recall 并传入真实客户端 session_id;install 后 SessionStart 会写 .fabric/.cache/active-session.json 供服务端回填。仍要求 path-overlap:recall 要覆盖将编辑的文件,不要只 recall 无关的 .fabric 路径。见 AGENTS.md 与 docs/UPGRADE.md。",

  // `fabric audit --help` — 过滤式帮助(i18n 子命令清单)。
  "cli.audit.help.tagline": "知识与遥测审计面(只读)",
  "cli.audit.help.sub.cite": "Cite 政策遵循度报告",
  "cli.audit.help.sub.conflicts": "知识冲突体检",
  "cli.audit.help.sub.history": "维护历史汇总(archive | fix | all)",
  "cli.audit.help.sub.descriptions": "回填描述级 frontmatter 字段",
  "cli.audit.help.sub.retired": "扫描 agent 面中的废弃工具/字段引用",
  "cli.audit.help.sub.why": "诊断某条知识为何没浮现",
  "cli.audit.help.example.cite": "近 7 天的 cite 覆盖率",
  "cli.audit.help.example.conflicts": "扫描矛盾 / 重复条目",
  "cli.audit.help.footer": "运行 `fabric audit <subcommand> --help` 查看各子命令参数。",

  // `fabric audit retired` — 平铺渲染文案。
  "cli.audit.retired.skipped": "已跳过 retired 引用扫描 —— 未发现 agent 消费面。",
  "cli.audit.retired.clean": "无 retired 引用 —— 已扫描 {count} 个 agent 面。",
  "cli.audit.retired.found": "在 {files} 个文件中发现 {hits} 处 retired 引用",
  "cli.audit.retired.removed": "（已移除）",

  // `fabric audit why-not-surfaced <id>` — 三轴诊断(store / scope / timing)。
  "cli.audit.why.not-found": "未在任何已挂载 store 中找到 '{id}'。请核对 id(可试 `fabric store list`)。",
  "cli.audit.why.store-unbound": "'{id}' 位于 store '{store}',但该 store 未绑定到本项目。",
  "cli.audit.why.store-unbound.hint": "绑定它:fabric store bind {store}",
  "cli.audit.why.project-mismatch": "'{id}' 的 scope 是 '{scope}',但本仓库绑定的是 'project:{project}'。",
  "cli.audit.why.project-mismatch.hint": "它只在绑定了 '{scope}' 的仓库中浮现(semantic_scope 轴)。",
  "cli.audit.why.narrow-timing": "'{id}' 是 relevance_scope=narrow —— 仅在你编辑匹配文件时由 PreToolUse 提示浮现,不在 SessionStart。",
  "cli.audit.why.narrow-timing.hint": "broad 条目是常驻脊柱;narrow 仅在编辑时浮现(timing 轴)。",
  "cli.audit.why.should-surface": "'{id}' 应当正在浮现 —— store '{store}' 已绑定、scope 匹配、relevance_scope=broad。",
  "cli.audit.why.should-surface.hint": "若仍没浮现,可能是 SessionStart 快照过期:开个新会话或重跑 `fabric install`。",

  // `fabric info --help` —— flag 与 scope 子命令描述。
  "cli.info.args.global.description": "显示全局身份(whoami)而非项目状态",
  "cli.info.args.recall.description": "显示召回引擎详情(融合策略 + 向量嵌入状态)",
  "cli.info.args.warm.description":
    "配合 --recall:立即加载 embedder(首次会把模型下载到 ~/.fabric/cache/embed)",
  "cli.info.args.json.description": "输出机器可读的 JSON 而非文本",
  "cli.info.scope.description":
    "(进阶/skill)把一个 scope 坐标解析成 read-set + 写入目标的 JSON",
  "cli.info.scope.args.coord.description": "Scope 坐标(如 team、project:x、personal)",
  "cli.info.scope.args.json.description": "输出机器可读的 JSON(scope 始终输出 JSON)",

  "cli.config.description":
    "打开 Fabric 交互式配置面板（语言、知识层、审计模式、MCP 客户端配置等）",
  "cli.config.args.target.description": "目标项目目录（默认当前工作目录）。",
  "cli.config.clients.claude": "Claude Code CLI",
  "cli.config.install.description": "将 Fabric MCP 服务端条目安装到检测到的客户端配置中。",
  "cli.config.install.args.clients.description": "可选的逗号分隔客户端过滤器，例如 cc,codex。",
  "cli.config.install.args.dry-run.description": "仅预览将要发生的写入操作，不修改文件。",
  "cli.config.errors.unknown-client":
    "未知客户端\u201c{client}\u201d。请使用逗号分隔列表，例如 cc,codex。",
  "cli.config.errors.expected-object": "{path} 中应为对象。",
  "cli.config.install.no-configs":
    "未检测到 Fabric MCP 客户端配置。请创建客户端目录，或在 fabric.config.json 中设置 clientPaths。",
  "cli.config.install.no-config-path": "跳过 {client}：未检测到配置路径。",
  "cli.config.install.dry-run": "[dry-run] {client}：将写入 {path}",
  "cli.config.install.wrote": "{client}：已写入 {path}",

  // rc.16 TASK-006 (F1-panel): clack 驱动的 `fabric config` 交互式面板。
  // 由 packages/cli/src/commands/config.ts（菜单循环 + 字段编辑）以及
  // getPanelFields() 的 label_i18n_key 引用消费。
  "cli.config.intro": "Fabric 配置",
  // flat-design-system Wave5 (TASK-005): clack 编辑菜单前那块平铺键值面板的
  // B-横线标题。
  "cli.config.panel.title": "当前配置",
  "cli.config.outro": "配置已保存。",
  "cli.config.outro-no-changes": "未做任何修改。",
  "cli.config.cancel": "已取消。",
  "cli.config.non-tty-notice":
    "fabric config 需要在交互式终端中运行。请在 TTY 中执行以编辑配置字段。",
  "cli.config.menu.field-select": "选择要编辑的字段：",
  "cli.config.menu.exit": "退出",
  "cli.config.value.current": "当前：{value}",
  "cli.config.value.default-marker": "（默认）",
  "cli.config.prompt.select": "为 {key} 选择新值（当前：{current}）：",
  "cli.config.prompt.text": "为 {key} 输入新值（当前：{current}）：",
  "cli.config.write.success": "{key} = {value}",
  "cli.config.panel.edited": "本次已改（{count} 项）：{keys}",
  "cli.config.write.failure": "写入 fabric-config.json 失败：{message}",
  "cli.config.slot.errors.missing": "缺少必填的 <slot> 参数。可用槽位：{slots}。",
  "cli.config.slot.errors.unknown": "未知槽位 \"{slot}\"。可用槽位：{slots}。",
  "cli.config.slot.dismiss.already": "槽位 \"{slot}\" 已忽略，无需操作。",
  "cli.config.slot.dismiss.done": "已忽略 onboard 槽位 \"{slot}\"。运行 `fabric config onboard-reset {slot}` 可重新开启。",
  "cli.config.slot.dismiss.failed": "dismiss-slot 失败：{message}",
  "cli.config.slot.reset.not-opted": "槽位 \"{slot}\" 未被忽略，无需操作。",
  "cli.config.slot.reset.done": "已重置 onboard 槽位 \"{slot}\"；它将在 `fabric onboard-coverage` 中重新显示为缺失。",
  "cli.config.slot.reset.failed": "onboard-reset 失败：{message}",
  "cli.config.errors.uninit-workspace.message":
    "工作区尚未初始化。请先运行 `fabric install`。",
  "cli.config.errors.invalid-int": "必须是正整数。",
  "cli.config.errors.unknown-field": "未知字段选择 — 已跳过。",
  "cli.config.errors.no-enum-options": "该字段没有可选枚举值 — 已跳过。",
  // 11 个面板字段标签（A 组 2 个 + B 组 8 个 + C 组 1 个）。
  "cli.config.fields.fabric_language.label": "语言",
  "cli.config.fields.fabric_language.description":
    "Fabric 的全局语言基调（界面与知识统一），保存到 ~/.fabric/fabric-global.json。",
  "cli.config.fields.default_layer_filter.label": "默认知识层",
  "cli.config.fields.default_layer_filter.description":
    "知识列表的默认层级范围（team / personal / both）。",
  "cli.config.fields.archive_hint_hours.label": "归档提示窗口（小时）",
  "cli.config.fields.archive_hint_hours.description":
    "Signal A 用于检测频繁编辑的时间窗口（小时）。",
  "cli.config.fields.archive_hint_cooldown_hours.label": "归档提示冷却（小时）",
  "cli.config.fields.archive_hint_cooldown_hours.description":
    "同一归档提示再次触发前的冷却时间（小时）。",
  "cli.config.fields.archive_edit_threshold.label": "归档编辑阈值",
  "cli.config.fields.archive_edit_threshold.description":
    "触发 Signal A 归档提示所需的编辑次数阈值。",
  "cli.config.fields.underseed_node_threshold.label": "知识节点不足阈值",
  "cli.config.fields.underseed_node_threshold.description":
    "知识节点数低于该阈值时，Fabric 视为知识库尚未充实。",
  "cli.config.fields.review_hint_pending_count.label": "待审条目数阈值",
  "cli.config.fields.review_hint_pending_count.description":
    "待审条目数超过该阈值时触发审核提示。",
  "cli.config.fields.review_hint_pending_age_days.label": "待审条目年龄（天）",
  "cli.config.fields.review_hint_pending_age_days.description":
    "待审条目存留天数超过该阈值时触发审核提示。",
  "cli.config.fields.maintenance_hint_days.label": "维护提示窗口（天）",
  "cli.config.fields.maintenance_hint_days.description":
    "Fabric 触发知识维护提示的时间窗口（天）。",
  "cli.config.fields.maintenance_hint_cooldown_days.label": "维护提示冷却（天）",
  "cli.config.fields.maintenance_hint_cooldown_days.description":
    "维护提示再次触发前的冷却时间（天）。",
  "cli.config.fields.audit_mode.label": "审计模式",
  "cli.config.fields.audit_mode.description":
    "human-lock 与漂移检测的审计粒度（strict / warn / off）。",
  "cli.config.fields.nudge_mode.label": "提示档位",
  "cli.config.fields.nudge_mode.description":
    "人类可见 nudge 的总档位（silent 静默 / minimal 精简 / normal 正常 / verbose 详尽）；仅控人类提示通道，不影响注入给 AI 的知识。",
  "cli.config.fields.embed_enabled.label": "向量语义检索",
  "cli.config.fields.embed_enabled.description":
    "是否启用向量语义检索（true / false）。注意：true 只是意图开关——真正生效还需运行中的 server 能解析到 fastembed 包、且模型已下载（首次召回时自动下到 ~/.fabric/cache/embed）。用 `fabric info recall` 查实际状态。",
  "cli.config.fields.fusion.label": "召回融合策略",
  "cli.config.fields.fusion.description":
    "多信号合成总分的算法：additive 加权求和（BM25 主导，向量权重小）/ rrf 倒数排名融合（BM25 与向量平起平坐，语义才真正生效）/ auto 自适应（默认：向量在出分时用 rrf，否则回落 additive——避免无向量时 rrf 退化反而更差）。",

  "cli.doctor.description":
    "运行 Fabric 目标态诊断（meta 同步、知识索引、bootstrap、events ledger、human-lock 漂移）",
  "doctor.section.fixable": "可修复错误：",
  "doctor.section.manual": "需手动修复：",
  "doctor.section.warnings": "警告：",
  "doctor.section.fix-knowledge-mutations": "知识侧变更：",
  // flat-design follow-up: doctor 剩余的 UI-shell 文案(TL;DR 头、--fix 变更计划、
  // 过滤版 --help)从硬编码英文搬进 i18n,让整个 `fabric doctor` 输出跟随机器语言。
  // USAGE/OPTIONS/EXAMPLES 标签保持英文,与其它命令 --help 的 citty renderUsage 对齐。
  "doctor.digest.todo": "待处理 ({count})",
  "doctor.digest.clean": "全部 {count} 项检查通过 —— 无需处理",
  "doctor.digest.summary": "{todo} 项待处理 · {ok} 项通过 · 贡献者诊断见 --verbose",
  "doctor.digest.more-verbose": "另有 {count} 项贡献者诊断 —— 见 --verbose",
  // store 诊断(多 store 健康,即 `● 存储健康` 分组)—— 与 doctor.check.* 对齐 i18n;
  // 文案通过插值带上 store alias / 计数。
  "doctor.store.no-global-config": "无全局 Fabric 配置 —— 运行 `fabric install --global <url>`",
  "doctor.store.missing-required": "必需 store '{id}' 未挂载;运行 `fabric store mount`",
  "doctor.store.unbound": "store '{alias}' 已挂载但未绑定到本项目 — 粘贴执行: `fabric store bind {alias}` 然后 `fabric store switch-write {alias}`",
  "doctor.store.empty": "已绑定 store 知识条数为 0（{stores}）——在 seed 或 clone 有内容前无法 first-hit；运行 `fabric first-hit --seed`（空本地库）或绑定带内容的远程 team store",
  "doctor.store.no-write-target": "本项目无 active write store — 粘贴执行: `fabric store bind <alias>` 然后 `fabric store switch-write <alias>`（或 `fabric install`）",
  "doctor.store.no-match": "知识存在但与探测路径无匹配 —— 放宽 paths 或为模块补 relevance_paths",
  "doctor.store.write-target-mismatch":
    "活动写库 '{alias}' 不是本项目的有效 team 写目标 —— 运行 `fabric store switch-write <已挂载 team 别名>`",
  "doctor.store.first-hit-missing-required":
    "必需 store 未挂载: {ids} —— 先 bind/clone 再跑 `fabric first-hit`",
  "doctor.store.first-hit-unreachable":
    "已绑定 store 目录磁盘缺失: {aliases} —— remount/re-clone 后跑 `fabric doctor`",
  "doctor.store.hooks-missing": "知识已有但 SessionStart/PreToolUse hooks 缺失 —— 重跑 `fabric install`",
  "doctor.store.first-hit-ok": "first-hit 就绪：{count} 条知识，store：{stores}",
  "doctor.store.alias-drift": "by-alias 可读性软链与注册表不同步:{refs};运行 `fabric doctor --fix` 修复 ~/.fabric/stores/by-alias/",
  "doctor.store.local-only": "store '{alias}' 仅本地;加一个 git remote 以备份",
  "doctor.store.executable": "store '{alias}' 含可执行/脚本文件({files})—— store 仅存数据;Fabric 从不运行它们 (S65)",
  "doctor.store.active-personal-invalid": "活动 personal store '{store}' 不是已挂载的 personal store;运行 `fabric store switch-personal <alias>` 或 `fabric doctor --fix`",
  "doctor.store.active-personal-unset": "已挂载 {count} 个 personal store 但无活动指针;运行 `fabric store switch-personal <alias>` 选一个(或 `fabric doctor --fix` 默认取第一个)",
  "doctor.store.related-broken": "{count} 条 `related` 链接指向语料中不存在的 id:{samples}{overflow} —— 通过 `fab_review` (modify) 修复 related 边,或编辑条目 frontmatter",
  "doctor.store.related-hub": "related 图谱枢纽(前 {shown} / 共 {total} 个被引用):{top}",
  "doctor.store.unreachable": "store '{alias}' 在 read-set 中但磁盘上不可达({reason});运行 `fabric store mount` / 重新 clone,再跑 `fabric doctor`",
  "doctor.store.unreachable-bound": "已绑定 store 的磁盘目录缺失：{stores} — 请 re-clone 或 remount，再跑 fabric doctor",
  "doctor.store.consumption-heatmap": "消费热区(近 {days}d,{consumed}/{total} 条被读,跨 {windows} 个窗口):{top}",
  "doctor.store.consumption-zero": "{count} 条在近 {days}d 内从未被消费:{sample}{overflow} —— 通过 `fab_review` 考虑淘汰(消费量只是信号之一,非陈旧的证据)",
  "doctor.store.overflow-more": ", …(+{count} 条)",

  "doctor.check.knowledge_body_altitude_dump.name": "知识正文 altitude",
  "doctor.check.knowledge_body_altitude_dump.ok": "未发现 dump 形态的知识正文。",
  "doctor.check.knowledge_body_altitude_dump.message.singular": "1 条 dump 形态知识正文: {detail}",
  "doctor.check.knowledge_body_altitude_dump.message.plural": "{count} 条 dump 形态知识正文(例如 {detail})",
  "doctor.check.knowledge_body_altitude_dump.remediation": "改写成可复用的 decision/pitfall/guideline altitude(带 ## 结构),不要贴 session 流水;经 fabric-archive / fab_propose 重归档",
  "doctor.check.knowledge_body_altitude_dump.scan_error": "正文 altitude 扫描失败({detail});doctor 无法确认语料干净。",
  "doctor.fix-plan.header": "知识侧变更计划(共 {count} 项)",
  "doctor.fix-plan.preview": "预览:",
  "doctor.fix-plan.more": "... 还有 {count} 项",
  "doctor.help.tagline": "诊断并修复 Fabric 工作区问题",
  "doctor.help.flag.target": "覆盖项目根目录(默认当前目录)",
  "doctor.help.flag.fix": "自动修复(派生状态 + 知识侧 cache/counter 变更)",
  "doctor.help.flag.json": "以 JSON 输出供程序消费",
  "doctor.help.flag.verbose": "显示面向维护者的操作提示",
  "doctor.help.example.run": "运行诊断",
  "doctor.help.example.fix": "修复派生状态 + 知识问题",
  "doctor.help.footer": "运行 `fabric doctor` 查看完整诊断报告。审计 → `fabric audit`。",
  // flat-design-system Wave5 (TASK-005): 重排后的 doctor C-圆点分组标题
  // (`● 存储健康` / `● 检查项`),取代原硬编码 sectionBar 字面量。
  "doctor.group.store-health": "存储健康",
  "doctor.group.checks": "检查项",
  // v2.0.0-rc.29 REVIEW (codex LOW-2): F2 的 payload 阈值之前只出现在 JSON envelope，
  // 人类输出看不到，导致改了 mcpPayloadLimits 之后没法用 `fabric doctor` 快速确认是否生效。
  "doctor.section.payload-limits": "MCP payload 阈值：",
  "doctor.payload-limits.line": "warn={warnKb} KB, hard={hardKb} KB (来源: {source})",
  // rc.20 TASK-07: cite-coverage 人类可读格式化键。
  "doctor.section.cite-coverage": "Cite 覆盖率:",
  "doctor.cite.header": "起始 {since} (政策激活时间 {marker})",
  "doctor.cite.warning.justActivated": "本次首次激活 Cite policy,暂无历史数据。",
  "doctor.cite.metric.editsTouched": "编辑触达数",
  "doctor.cite.metric.qualifyingCites": "合格 cite 数",
  "doctor.cite.metric.recalledUnverified": "已标注 applied 但未验证",
  "doctor.cite.metric.expectedButMissed": "应查没查",
  "doctor.cite.metric.totalTurns": "总回合数",
  "doctor.cite.metric.complianceRate": "cite 合规率（含 KB:none[reason]）",
  "doctor.cite.metric.complianceNA": "N/A（无应 cite 回合）",
  "doctor.cite.metric.uncorrelatableEdits": "无法关联的编辑（缺 session_id —— hook 过期?请跑 `fabric install`）",
  "doctor.cite.metric.recallCoverage": "recall 覆盖率（改前有相关 fab_recall 的编辑占比）",
  "doctor.cite.metric.recallCoverageNA": "N/A（无可关联编辑）",
  // v2.2.0-rc.1 W1-T3 (cite 诚实拆分): 弱辅助信号, 与真遵循率分列展示。括注必须
  // 明确「不计入真遵循度」(诚实铁律)。
  "doctor.cite.metric.exposedAndMutated":
    "曝光且路径变更（弱辅助信号 —— 不计入真遵循度）",
  // lifecycle-refactor W2-T4 (§5 row7/row2): PostToolUse mutation funnel +
  // SessionEnd 边界。均为可观测性 marker, 不计入真遵循度。
  "doctor.cite.metric.mutationsObserved":
    "mutation 观测数（PostToolUse file_mutated —— 权威信号,不计入真遵循度）",
  "doctor.cite.metric.mutationPool":
    "mutation 归因池（经 source_event_id 的低置信归因）",
  "doctor.cite.metric.sessionsClosed":
    "已闭合会话数（SessionEnd marker —— funnel 边界）",
  "doctor.cite.metric.byStore":
    "按 store 拆分的合规 cite 数（诊断拆分 —— 不计入真遵循度;'local' = 本项目）",
  "doctor.cite.section.perClient": "按客户端拆分",
  "doctor.cite.section.dismissedReasons": "驳回原因分布",
  "doctor.cite.dismissed.scope-mismatch": "范围不符",
  "doctor.cite.dismissed.outdated": "已过期",
  "doctor.cite.dismissed.not-applicable": "不适用",
  "doctor.cite.dismissed.other": "其他",
  "doctor.cite.dismissed.unspecified": "未注明",
  "doctor.cite.section.noneReasons": "KB: none 原因分布",
  "doctor.cite.none.no-relevant": "已查无可用",
  "doctor.cite.none.not-applicable": "不在范围",
  "doctor.cite.none.unspecified": "未注明",
  "doctor.cite.status.skipped": "本工作区 Cite policy 尚未激活。",
  // v2.0.0-rc.24 TASK-09: cite-coverage 合约审计渲染键（contract-policy 审计窗口）。
  // 配套 schema：packages/shared/src/schemas/api-contracts.ts citeCoverageReportSchema。
  // 渲染器消费方：TASK-10 CLI doctor --cite-coverage（layer / type / skip / status / contract）。
  "cite-coverage.contract.header": "应用契约校验",
  "cite-coverage.contract.decisions_cited": "decisions 引用",
  "cite-coverage.contract.pitfalls_cited": "pitfalls 引用",
  "cite-coverage.contract.with": "已附契约",
  "cite-coverage.contract.missing": "缺契约",
  "cite-coverage.contract.hard_violated": "硬性违规（操作符未匹配 session 编辑）",
  "cite-coverage.contract.cite_id_unresolved": "引用 ID 不存在",
  "cite-coverage.contract.skip_count": "skip 桶",
  "cite-coverage.contract.status.ok": "正常",
  "cite-coverage.contract.status.skipped_bootstrap_drift":
    "已跳过（bootstrap drift — 请运行 fabric install）",
  "cite-coverage.contract.status.awaiting_marker": "等待首次 marker emit",
  // 复数知识类型（rc.29 BUG-C1: 与统一后的 KnowledgeTypeSchema 枚举字面量逐字对齐）+ 第六桶 unresolved。
  "cite-coverage.contract.type.decisions": "decisions",
  "cite-coverage.contract.type.pitfalls": "pitfalls",
  "cite-coverage.contract.type.models": "models",
  "cite-coverage.contract.type.guidelines": "guidelines",
  "cite-coverage.contract.type.processes": "processes",
  "cite-coverage.contract.type.unresolved": "unresolved",
  // 知识层标签（per_layer_type 表头 + layer_filter 标识）。
  "cite-coverage.layer.team": "team",
  "cite-coverage.layer.personal": "personal",
  "cite-coverage.layer.team_review": "[team — 需复核]",
  "cite-coverage.layer.personal_fyi": "[personal — fyi]",
  // skip_reason 标准词表（bootstrap 文档定义；运营方可继续扩展词条，渲染器对未知键回退到原始 key）。
  "cite-coverage.skip.sequencing": "顺序约束",
  "cite-coverage.skip.conditional": "条件分支",
  "cite-coverage.skip.semantic": "语义约束",
  "cite-coverage.skip.aesthetic": "美学/风格",
  "cite-coverage.skip.architectural": "架构层",
  "cite-coverage.skip.other": "其他",
  "cli.doctor.args.target.description":
    "目标项目路径。默认依次使用 --target、EXTERNAL_FIXTURE_PATH、当前目录。",
  "cli.doctor.args.fix.description":
    "自动修复派生状态（meta/索引/锁）与知识侧变更（store 计数器 floor、陈旧 session-hints 缓存清理）。衰减类 lint(orphan demote / stale archive)仍只读上报 — 请走 fab_review。",
  "cli.doctor.args.json.description": "以 JSON 输出 doctor 报告。",
  "cli.doctor.args.strict.description": "将 warning 也视为失败。",
  "cli.doctor.args.fix-knowledge.description":
    "（内部/legacy 名称）知识侧 mutation 臂，现已由 `fabric doctor --fix` 一并调用。勿再单独依赖 --fix-knowledge。",
  "cli.doctor.args.yes.description":
    "跳过 --fix 知识侧安全确认；非 tty 调用必须显式设置该标记，或在环境变量中设置 FABRIC_NONINTERACTIVE=1。",
  // rc.35 TASK-12 (P0-11): --verbose 展开 maintainer 受众的 remediation。
  "cli.doctor.args.verbose.description":
    "展开全部 action hint,包括 maintainer 受众的(Fabric 贡献者修源码用)。默认 npm 终端用户视图会把这些折叠。",
  "doctor.maintainer-hint-folded":
    "(maintainer-only remediation — 加 `fabric doctor --verbose` 查看)",
  "cli.doctor.errors.fix-knowledge-fix-mutually-exclusive":
    "--fix-knowledge 与 --fix 不可同时使用。--fix-knowledge 修改用户知识状态（归档/计数器/缓存）；--fix 修复派生状态（meta/索引）。请分别运行。",
  // rc.20 TASK-05: --cite-coverage 报告参数；只读，与 --fix/--fix-knowledge 互斥。
  "cli.doctor.args.cite-coverage.description":
    "Cite 政策合规报告(只读;跳过标准检查)",
  "cli.doctor.args.since.description":
    "Cite 覆盖率统计窗口(如 7d, 24h, 30m)",
  "cli.doctor.args.client.description":
    "按客户端过滤(cc|codex|all)",
  // v2.0.0-rc.24 TASK-10: --layer 过滤 cite 合约审计的知识层 (team|personal|all)。
  "cli.doctor.args.layer.description":
    "按知识层过滤 cite 合约审计 (team|personal|all)",
  "cli.doctor.errors.cite-coverage-mutex":
    "--cite-coverage 不能与 --fix 或 --fix-knowledge 同时使用",
  "cli.doctor.errors.lint-conflicts-mutex":
    "--lint-conflicts 不能与 --fix / --fix-knowledge / --cite-coverage 同时使用",
  "cli.doctor.args.lint-conflicts.description":
    "体检知识库中互相矛盾/重复的条目对 (bm25 候选)",
  "cli.doctor.args.deep.description":
    "配合 --lint-conflicts: 对候选对跑 LLM 判定 (冷评 seam)",
  "doctor.conflict.header": "知识冲突体检",
  "doctor.conflict.none": "未发现可疑的矛盾/重复条目对",
  "doctor.conflict.summary":
    "{candidates} 个候选对, {conflicts} 个判定为矛盾 (相似度 ≥ {threshold})",
  "doctor.conflict.deep_no_judge":
    "已请求 --deep 但未接入 LLM judge (请手动跑冷评 review);先展示便宜候选",
  "doctor.conflict.verdict.conflict": "矛盾",
  "doctor.conflict.verdict.similar": "相似 (可能重复)",
  "doctor.conflict.verdict.unknown": "待审 (可能重复或矛盾)",
  "cli.doctor.errors.invalid-since":
    "--since 取值无效: {input}。预期格式 7d / 24h / 30m 或 epoch ms。",
  "cli.doctor.errors.invalid-client":
    "--client 取值无效: {input}。预期 cc / codex / all。",
  "cli.doctor.errors.invalid-layer":
    "--layer 取值无效: {input}。预期 team / personal / all。",
  // rc.23 TASK-007 (a-C2): --enrich-descriptions 回填四个 description 字段。
  "cli.doctor.args.enrich-descriptions.description":
    "回填正式知识条目缺失的 intent_clues / tech_stack / impact / must_read_if 字段（默认只读;搭配 --auto 写入 stub）。",
  "cli.doctor.args.auto.description":
    "与 --enrich-descriptions 搭配：为缺失字段写入确定性 stub 值。不加 --auto 仅做只读扫描。",
  "cli.doctor.args.dry-run.description":
    "与 --enrich-descriptions --auto 或 --fix 搭配:仅预览改动计划,不写入磁盘。fix-dry-run 输出与 --fix 相同的 fixable_errors 列表,但不执行任何 mutation。",
  // v2.0.0-rc.33 W4-B1 (T6 P2): --fix --dry-run banner — 出现在 report 之前, 让用户明确没有发生 mutation。
  "cli.doctor.fix-dry-run-banner":
    "[dry-run] 未应用任何 mutation。下方 fixable_errors 列表就是 `fabric doctor --fix` 会处理的项;去掉 --dry-run 再跑可实际修复。",
  "cli.doctor.unbound-project-backfilled":
    "已回填 store '{alias}' 的 project-scope 绑定 → project '{project}'(铸 project_id + active_project)。",
  "cli.doctor.errors.enrich-descriptions-mutex":
    "--enrich-descriptions 不能与 --fix / --fix-knowledge / --cite-coverage 同时使用,请分别运行。",
  "doctor.enrich.allComplete":
    "所有正式知识条目均已包含 intent_clues / tech_stack / impact / must_read_if。",
  // rc.26 TASK-02a: doctor foundation-batch check messages.
  "doctor.check.bootstrap_snapshot_drift.name": "Bootstrap 快照漂移",
  "doctor.check.bootstrap_snapshot_drift.message.drift":
    ".fabric/AGENTS.md 内容与 BOOTSTRAP_CANONICAL 逐字节不一致。",
  "doctor.check.bootstrap_snapshot_drift.remediation.drift":
    "运行 `fabric doctor --fix` 恢复 canonical bootstrap snapshot",
  "doctor.check.bootstrap_snapshot_drift.ok.ok":
    ".fabric/AGENTS.md 与 BOOTSTRAP_CANONICAL 逐字节一致。",
  "doctor.check.bootstrap_snapshot_drift.ok.missing_delegated":
    ".fabric/AGENTS.md 不存在，已交由 bootstrap_anchor_missing 报告。",
  "doctor.check.managed_block_drift.name": "Managed block 漂移",
  "doctor.check.managed_block_drift.message.singular":
    "{count} 个 three-end managed block 与期望内容（snapshot + 可选 project-rules concat）不一致：{list}。",
  "doctor.check.managed_block_drift.message.plural":
    "{count} 个 three-end managed block 与期望内容（snapshot + 可选 project-rules concat）不一致：{list}。",
  "doctor.check.managed_block_drift.remediation":
    "运行 `fabric doctor --fix` 从 canonical 恢复 three-end managed blocks",
  "doctor.check.managed_block_drift.ok.ok":
    "Three-end managed blocks 与 expectedBody 逐字节一致。",
  "doctor.check.managed_block_drift.ok.no_managed_block":
    "未检测到 three-end managed blocks；可能尚未传播，或仍处于 legacy-marker 状态。",
  "doctor.check.bootstrap_anchor.name": "Bootstrap 锚点",
  "doctor.check.bootstrap_anchor.message.missing":
    "repo root 下 AGENTS.md 与 CLAUDE.md 都不存在。Fabric 需要在项目根目录存在 bootstrap anchor 文件。",
  "doctor.check.bootstrap_anchor.remediation.missing":
    "运行 `fabric install` 在 repo root 生成 AGENTS.md / CLAUDE.md bootstrap anchor。",
  "doctor.check.bootstrap_anchor.ok": "repo root 下已存在 Bootstrap anchor：{present}。",
  // v2.0.0-rc.33 W3-2 (T6 #5): 文案显式引用 message 内已列出的 detail (file 名), 让用户直接 rm 而非自己去 grep 找。baseline pipeline 已 rc.23 移除, 没有 auto-fix。
  "doctor.check.forensic.name": "扫描证据",
  "doctor.check.forensic.message.missing.singular":
    "{error} 实时扫描检测到 {frameworkKind}，共有 {count} 个入口点。",
  "doctor.check.forensic.message.missing.plural":
    "{error} 实时扫描检测到 {frameworkKind}，共有 {count} 个入口点。",
  "doctor.check.forensic.message.missing-default": ".fabric/forensic.json 缺失。",
  "doctor.check.forensic.message.invalid-default": ".fabric/forensic.json 无效。",
  "doctor.check.forensic.remediation": "运行 `fabric install` 重新生成 .fabric/forensic.json。",
  "doctor.check.forensic.ok": ".fabric/forensic.json 对 {frameworkKind} 有效。",
  "doctor.check.agents_meta.name": "Agents 元数据",
  "doctor.check.agents_meta.message.missing": ".fabric/agents.meta.json 缺失。",
  "doctor.check.agents_meta.remediation.missing":
    "store-backed knowledge 下无需处理；项目本地 agents.meta 重建路径已退休。",
  "doctor.check.agents_meta.message.invalid-default": ".fabric/agents.meta.json 无效。",
  // rc.35 TASK-09 (P0-14): 人话化的 schema 解析失败消息。
  "doctor.check.agents_meta.message.invalid-zod":
    ".fabric/agents.meta.json schema 校验失败 — {issues}。该文件很可能由不兼容版本的 fabric CLI 写入,或被手工编辑。",
  "doctor.check.agents_meta.message.invalid-from-old-cli":
    ".fabric/agents.meta.json schema 校验失败,因为 PATH 上的全局 `fabric` CLI ({version}) 低于最低支持版本 {minVersion}。rc.31 引入了向后兼容的 singular→plural 归一化,旧版 CLI 写出的文件自己也无法解析。",
  "doctor.check.agents_meta.remediation.invalid":
    "项目本地 agents.meta 已退休。运行 `fabric install` 刷新客户端 bootstrap，并把 knowledge 保持在 ~/.fabric/stores/ 下的 mounted store 中。",
  "doctor.check.agents_meta.message.stale":
    ".fabric/agents.meta.json revision {revision} 与已退休的本地派生 revision {computedRevision} 不一致。",
  "doctor.check.agents_meta.message.stale_hash_equal":
    ".fabric/agents.meta.json 已与已退休的本地派生 revision {revision} 对齐；该检查仅作历史兼容。",
  "doctor.check.agents_meta.remediation.stale":
    "不再执行项目本地 reconcile；mounted stores 会被直接读取。",
  "doctor.check.agents_meta.ok":
    "检测到 legacy agents.meta revision {revision}；store-backed knowledge 不依赖它。",
  "doctor.check.rule_content_refs.name": "Rule 内容引用",
  "doctor.check.rule_content_refs.message.unavailable":
    "agents.meta.json 有效前，无法检查 content_ref entries。",
  "doctor.check.rule_content_refs.remediation.unavailable":
    "先修复 agents.meta.json：运行 `fabric doctor --fix`。",
  "doctor.check.rule_content_refs.message.outside.singular":
    "{count} 个 legacy content_ref entry 位于已退休的本地 knowledge root 外部。",
  "doctor.check.rule_content_refs.message.outside.plural":
    "{count} 个 legacy content_ref entries 位于已退休的本地 knowledge root 外部。",
  // v2.0.0-rc.33 W3-2 (T6 #12): 项目规则禁止手动编辑 agents.meta.json (见 .fabric/AGENTS.md); 改引导用户跑 doctor --fix 走 reconcile 路径 (rc.31+ 兼容自动剔除外部 refs)。
  "doctor.check.rule_content_refs.remediation.outside":
    "运行 `fabric doctor --fix` 让 reconcile 自动剔除外部 content_ref (rc.31+ 兼容)。严禁手动编辑 agents.meta.json — engine 会自动 reconcile。",
  "doctor.check.rule_content_refs.message.missing.singular":
    "{count} 个 content_ref target 缺失。运行 `fabric doctor --fix` 执行 reconcile。",
  "doctor.check.rule_content_refs.message.missing.plural":
    "{count} 个 content_ref targets 缺失。运行 `fabric doctor --fix` 执行 reconcile。",
  "doctor.check.rule_content_refs.remediation.missing":
    "项目本地 content_ref reconcile 已退休；请绑定并读取 mounted stores。",
  "doctor.check.rule_content_refs.ok":
    "所有 legacy content_ref entries 都能解析；store-backed knowledge 从 mounted stores 读取。",
  "doctor.check.knowledge_test_index.name": "知识测试索引",
  "doctor.check.knowledge_test_index.remediation.missing":
    "运行 `fabric doctor --fix` 重建 .fabric/.cache/knowledge-test.index.json。",
  "doctor.check.knowledge_test_index.remediation.invalid":
    "删除 .fabric/.cache/knowledge-test.index.json 并运行 `fabric doctor --fix` 重新生成。",
  "doctor.check.knowledge_test_index.message.stale":
    ".fabric/.cache/knowledge-test.index.json 已过期。",
  "doctor.check.knowledge_test_index.remediation.stale":
    "运行 `fabric doctor --fix` 重建 knowledge-test index。",
  "doctor.check.knowledge_test_index.ok.link_singular.orphan_singular":
    "已索引 {linkCount} 个 link 和 {orphanCount} 个 orphan annotation。",
  "doctor.check.knowledge_test_index.ok.link_singular.orphan_plural":
    "已索引 {linkCount} 个 link 和 {orphanCount} 个 orphan annotation。",
  "doctor.check.knowledge_test_index.ok.link_plural.orphan_singular":
    "已索引 {linkCount} 个 link 和 {orphanCount} 个 orphan annotation。",
  "doctor.check.knowledge_test_index.ok.link_plural.orphan_plural":
    "已索引 {linkCount} 个 link 和 {orphanCount} 个 orphan annotation。",
  "doctor.check.event_ledger.name": "事件账本",
  "doctor.check.event_ledger.message.missing": ".fabric/events.jsonl 缺失。",
  "doctor.check.event_ledger.remediation.missing":
    "运行 `fabric doctor --fix` 创建 .fabric/events.jsonl。",
  "doctor.check.event_ledger.message.not_writable-default":
    ".fabric/events.jsonl 不可写。",
  "doctor.check.event_ledger.remediation.not_writable":
    "检查 .fabric/events.jsonl 的文件权限，并确认没有其他进程持有写锁。",
  "doctor.check.event_ledger.message.invalid-default": ".fabric/events.jsonl 无效。",
  // v2.0.0-rc.33 W3-1 (P0-6): archive-history 模式 — 引导用户先 mv 备份到 events.archive/ 保留历史, 再跑 --fix 重建空 ledger。与 rotateEventLedgerIfNeeded 的命名约定一致 (events-rotated-YYYY-MM-DD.jsonl 是滑窗 rotation; events-corrupted-YYYY-MM-DD.jsonl 是 invalid-fix 归档)。
  "doctor.check.event_ledger.remediation.invalid":
    "先归档历史 (`mkdir -p .fabric/events.archive && mv .fabric/events.jsonl .fabric/events.archive/events-corrupted-$(date +%Y-%m-%d).jsonl`), 再运行 `fabric doctor --fix` 创建新空 ledger。历史事件保留在 events.archive/ 不丢。",
  "doctor.check.event_ledger.ok":
    ".fabric/events.jsonl 已存在，可写，且可解析。",
  // v2.0.0-rc.37 Wave B (B5): 复合 hard-gate 检查 events.jsonl/metrics.jsonl 健康
  // (G7 size / G8 metric_leak / G9 metrics_stale / G10 rotation_overdue)。
  "doctor.check.events_jsonl_health.name": "事件账本健康",
  "doctor.check.events_jsonl_health.ok":
    ".fabric/events.jsonl 大小、新鲜度、metric 隔离全部正常。",
  "doctor.check.events_jsonl_health.message.size":
    ".fabric/events.jsonl 已 {sizeMb} MB，超过 10 MB 阈值。",
  "doctor.check.events_jsonl_health.message.metric_leak":
    ".fabric/events.jsonl 含 {count} 行 metric-counter 类 event_type ({samples})。这些 event 应由 metrics.jsonl 计数, 不再进入 audit ledger。",
  "doctor.check.events_jsonl_health.message.metrics_stale":
    ".fabric/metrics.jsonl 已 {minutes} 分钟未更新；server-side 60s flush 可能 stalled。",
  "doctor.check.events_jsonl_health.message.rotation_overdue":
    ".fabric/events.jsonl 已 {days} 天未 rotate；6h rotation tick 可能未运行。",
  "doctor.check.events_jsonl_health.remediation":
    "运行 `fabric doctor --fix` —— 它会触发 rotation 并 flush metrics.jsonl(rc.2 F16: 无需重启 server 即可清出 idle 期未刷的 metric counter)。若告警仍持续, 再重启 MCP server 让 startMetricsFlush + startRotationTick 重新调度。若 metric_leak 命中, 检查最近代码改动是否绕过 bumpCounter API 直接 appendEventLedgerEvent 写了 4 个 metric-managed event_type 之一。",
  "doctor.check.event_ledger_partial_write.name": "事件账本半截写入",
  "doctor.check.event_ledger_partial_write.ok.skipped":
    "无需执行 partial-write 检查（ledger 缺失或不可写）。",
  "doctor.check.event_ledger_partial_write.message":
    "events.jsonl 在 byte offset {byteOffset} 处存在 partial write（{byteLength} 个 corrupted bytes）。运行 --fix 截断并保留 corrupted bytes。",
  "doctor.check.event_ledger_partial_write.remediation":
    "运行 `fabric doctor --fix` 截断 partial write 并将 events.jsonl 恢复到有效状态。",
  "doctor.check.event_ledger_partial_write.ok.clean":
    "events.jsonl 没有 partial trailing write。",
  // v2.0.0-rc.27 TASK-010 (audit §2.24): schema-compat 向前兼容警告类别。
  "doctor.check.event_ledger_schema_compat.name": "事件账本 schema 兼容性",
  "doctor.check.event_ledger_schema_compat.ok.skipped":
    "无需做 schema 兼容性检查（events.jsonl 不存在或不可写）。",
  "doctor.check.event_ledger_schema_compat.ok.clean":
    "events.jsonl 所有行都能解析为当前 schema。",
  "doctor.check.event_ledger_schema_compat.message.schema_version":
    "events.jsonl 含 {count} 行 `schema_version` 不被当前 CLI 识别（样本: {samples}）。",
  "doctor.check.event_ledger_schema_compat.message.event_type":
    "events.jsonl 含 {count} 行 `event_type` 不在当前 schema 中（样本: {samples}）。",
  // v2.0.0-rc.33 W3-1 (P0-6): archive-history 模式 — 同 event_ledger.invalid, 文案显式说"归档备份"而非"备份后重建",避免用户误以为旧 ledger 被丢弃。
  "doctor.check.event_ledger_schema_compat.remediation":
    "升级 fabric CLI 到与 server 兼容的版本 (首选);或先归档历史 (`mkdir -p .fabric/events.archive && mv .fabric/events.jsonl .fabric/events.archive/events-schema-mismatch-$(date +%Y-%m-%d).jsonl`),再跑 `fabric doctor --fix` 创建新空 ledger。历史事件保留在 events.archive/ 不丢,可后续手动迁移。",
  // v2.0.0-rc.28 TASK-04 (audit §3.1): SKILL ref/ 镜像一致性检查。
  "doctor.check.skill_ref_mirror.name": "Skill ref 镜像一致性",
  "doctor.check.skill_ref_mirror.ok":
    "`.claude/skills/<slug>/ref/` 与 `.codex/skills/<slug>/ref/` 字节一致。",
  "doctor.check.skill_ref_mirror.message":
    "有 {count} 个 ref 文件在 `.claude/skills/` 与 `.codex/skills/` 之间不一致（路径: {list}）。可能某端被手动编辑或 install 写入失败。",
  "doctor.check.skill_ref_mirror.remediation":
    "跑 `fabric install` 从 canonical templates 重写两端 ref 子树以恢复一致。",
  // ux-w2-2: retired-reference (stale pointer) lint。
  "doctor.check.retired_reference.name": "退役引用",
  "doctor.check.retired_reference.ok":
    "bootstrap、SKILL.md、已安装 hooks 中无残留的退役工具/字段名。",
  "doctor.check.retired_reference.message":
    "agent 可见文本中有 {count} 处指向退役工具/字段名的 stale pointer: {sample}",
  "doctor.check.retired_reference.remediation":
    "把命中文本改为替代 token (或删除), 再跑 `fabric install` 重同步 dogfood 镜像。",
  // v2.0.0-rc.33 W3-6 (P1-13): SKILL.md token budget lint。warn > 8K / error > 10K token (chars/3 估算)。Anthropic 推荐 SKILL.md 热路径 ~3K, 但被监控的两个 skill (fabric-archive/review) 是最丰富的核心 skill, 合理偏大;warn 定在 8K (距 10K 装机硬闸留 2K 反应缓冲) 而非 5K。超过 10K 是阻断级 (model context 浪费 + 加载延迟)。
  "doctor.check.skill_token_budget.name": "Skill token 预算",
  "doctor.check.skill_token_budget.ok":
    "所有 .claude/skills/<slug>/SKILL.md 在 token budget 内 (warn 8K / error 10K)。",
  "doctor.check.skill_token_budget.message.singular":
    "{count} 个 SKILL.md 超出 token budget: {list}。建议把详细内容下沉到 ref/ progressive disclosure。",
  "doctor.check.skill_token_budget.message.plural":
    "{count} 个 SKILL.md 超出 token budget: {list}。建议把详细内容下沉到 ref/ progressive disclosure。",
  "doctor.check.skill_token_budget.remediation":
    "将超标 SKILL.md 中的详细 phase / worked-examples / decision 表移到 `templates/skills/<slug>/ref/*.md`,SKILL.md 热路径只留 trigger gate + 关键 phase 概要;参考 W1 progressive disclosure 拆分模式。重新跑 `fabric install` 同步两端。",
  // v2.0.0-rc.33 W3-7 (P1-14): SKILL.md description 结构 lint。代理 trigger-recall (真 LLM 测要 live model, W1 已用 gemini 跑过);本 lint 抓回归: description 缺失 / 超 60 token / 缺中文 trigger / 缺英文 trigger / 缺 anti-trigger 边界。
  "doctor.check.skill_description.name": "Skill description 质量",
  "doctor.check.skill_description.ok":
    "所有 SKILL.md description 字段结构良好 (非空 / <60 token / 中英双语 trigger / 明确 anti-trigger 边界)。",
  "doctor.check.skill_description.message.singular":
    "{count} 个 SKILL.md description 结构问题: {list}。description 是 host 端 auto-invoke 的主要匹配信号。",
  "doctor.check.skill_description.message.plural":
    "{count} 个 SKILL.md description 结构问题: {list}。description 是 host 端 auto-invoke 的主要匹配信号。",
  "doctor.check.skill_description.remediation":
    "编辑 `packages/cli/templates/skills/<slug>/SKILL.md` frontmatter `description:` 字段: (1) 非空; (2) <60 token (chars/3 估算, 约 180 字符); (3) 至少 1 个中文 trigger 短语; (4) 至少 1 个英文 trigger 短语; (5) 明确 anti-trigger,如 `NOT PR review` / `NOT code review` / `不是...`。参考 W1 description rewrite 风格。重新跑 `fabric install` 同步两端。如需验证 recall, 跑 W1 的 gemini delegate (见 .workflow/.scratchpad/rc33-plan/W1-VERIFY-RESULT.md)。",
  "doctor.check.skill_contract.name": "Skill contract 完整性",
  "doctor.check.skill_contract.ok":
    "Fabric SKILL.md contract 完整: hard-rule anchors、MCP-only write path、thin shim 与 ref 入口均存在。",
  "doctor.check.skill_contract.message.singular":
    "{count} 个 Fabric skill contract 问题: {list}。",
  "doctor.check.skill_contract.message.plural":
    "{count} 个 Fabric skill contract 问题: {list}。",
  "doctor.check.skill_contract.remediation":
    "在 `packages/cli/templates/skills/<slug>/SKILL.md` 与对应 `ref/*.md` 中恢复缺失的 contract 文本,再跑 `fabric install` 同步 `.claude/skills` 与 `.codex/skills`。archive/review 必须保留 DISPLAY/WRITE hard rules 与 MCP-only mutation path;store/sync 必须保持 thin CLI shim。",
  // v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart 模式检测。扫 7d 内 assistant_turn_observed 事件, 3 个 anti-pattern (G1 仪式化 / G2 抄底引用 / G5 placeholder cite)。warning 级 (启发式有 false-positive, 不阻断)。
  "doctor.check.cite_goodhart.name": "Cite-policy Goodhart",
  "doctor.check.cite_goodhart.ok":
    "过去 7d 未检测到 cite-policy Goodhart 反模式。",
  "doctor.check.cite_goodhart.message.singular":
    "检测到 {count} 个 cite-policy Goodhart 模式: {list}。",
  "doctor.check.cite_goodhart.message.plural":
    "检测到 {count} 个 cite-policy Goodhart 模式: {list}。",
  "doctor.check.cite_goodhart.remediation":
    "审阅触发的 pattern: G1 仪式化 → 同一 [applied] cite 重复用,该把 KB 真正落到 contract; G2 抄底引用 → > 60% applied 用 skip: 是绕过 contract, review skip reason 真实性; G5 placeholder cite → 'KB: none' / [unspecified] 太多, 该用具体 sentinel 如 [no-relevant] / [not-applicable]。详细数据跑 `fabric doctor --cite-coverage --since=7d`。",
  // v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog lint。rc.32 baseline 92% entry 卡在 draft, 揭示 promote 断流。> 50% draft 触发 warning (workspace 必须 >= 10 entries 才计算比率, 避免小语料噪音)。
  "doctor.check.draft_backlog.name": "知识 draft 积压",
  "doctor.check.draft_backlog.ok":
    "canonical knowledge entries 中 draft 占比正常 (< 50%, 或 workspace 太小不评)。",
  "doctor.check.draft_backlog.message":
    "{draftCount}/{totalCount} ({pct}%) canonical knowledge entries 卡在 draft maturity — promote 断流 (rc.32 baseline 92%)。",
  "doctor.check.draft_backlog.remediation":
    "调 `/fabric-review` 批量审 draft entries: approve 升 verified/proven, reject 丢, modify 修。draft 长期堆积通常意味着 archive skill 产 draft 太快或 review skill 没跟上。",
  // rc.37 NEW-38: knowledge auto-promote (info surface; --fix 执行).
  // rc.36 TASK-05 (P0-8): empty-tags ratio warn.
  "doctor.check.knowledge_tags_empty.name": "知识 tags 覆盖率",
  "doctor.check.knowledge_tags_empty.ok":
    "canonical knowledge entries 中 empty tags 占比正常 (≤ 50%, 或 workspace 太小不评)。",
  "doctor.check.knowledge_tags_empty.message":
    "{emptyCount}/{totalCount} ({pct}%) canonical knowledge entries 的 `tags:` 为空 — 主题聚类与跨条目检索退化。fabric-archive skill 应每个 entry 产 2-4 个 tag。",
  "doctor.check.knowledge_tags_empty.remediation":
    "下一轮 archive/import 时,在 frontmatter `tags:` 写 2-4 个 kebab-case 主题词;批量补旧 entry tag 用 `/fabric-review` modify 流。",
  // rc.36 TASK-09 (P1-NEW1): drift_detected 未消化告警。
  "doctor.check.drift_unconsumed.name": "知识漂移未消化",
  "doctor.check.drift_unconsumed.ok":
    "近 30 天内 knowledge_drift_detected 事件已被对应 knowledge_demoted 消化,或事件数太少不评。",
  "doctor.check.drift_unconsumed.message":
    "近 30 天内 knowledge_drift_detected 事件 {driftCount} 次,knowledge_demoted 事件 {demoteCount} 次。drift > demote 至少 5 → 部分 drift 没被消化,KB 会缓慢失活。",
  "doctor.check.drift_unconsumed.remediation":
    "调 `/fabric-review` 审 drift 标记的条目 — 通过 store 写侧 review 流程降级或归档它们。(doctor 的 orphan_demote / stale_archive lint 只上报衰减,不自愈 store 知识。)",
  "doctor.check.meta_manually_diverged.name": "Meta 手动偏离",
  "doctor.check.meta_manually_diverged.ok.unreadable":
    "agents.meta.json 不可读，跳过 divergence 检查。",
  "doctor.check.meta_manually_diverged.message.extra.singular":
    "agents.meta.json 中有 {count} 个 entry 在磁盘上没有对应文件。运行 --fix 执行 reconcile。",
  "doctor.check.meta_manually_diverged.message.extra.plural":
    "agents.meta.json 中有 {count} 个 entries 在磁盘上没有对应文件。运行 --fix 执行 reconcile。",
  "doctor.check.meta_manually_diverged.remediation.extra":
    "项目本地 agents.meta reconcile 已退休；mounted stores 是 source of truth。",
  "doctor.check.meta_manually_diverged.message.hash.singular":
    "agents.meta.json 中有 {count} 个 entry 的 hash 与磁盘文件不匹配。运行 --fix 执行 reconcile。",
  "doctor.check.meta_manually_diverged.message.hash.plural":
    "agents.meta.json 中有 {count} 个 entries 的 hash 与磁盘文件不匹配。运行 --fix 执行 reconcile。",
  "doctor.check.meta_manually_diverged.remediation.hash":
    "项目本地 agents.meta reconcile 已退休；mounted stores 是 source of truth。",
  "doctor.check.meta_manually_diverged.ok.consistent":
    "agents.meta.json 与磁盘上的 rule files 一致。",
  "doctor.check.knowledge_dir_unindexed.name": "知识目录未索引",
  "doctor.check.knowledge_dir_unindexed.message.singular":
    "检测到 {count} 个 legacy local knowledge .md file 未索引。请移入 mounted store；非 store knowledge root 已退休。",
  "doctor.check.knowledge_dir_unindexed.message.plural":
    "检测到 {count} 个 legacy local knowledge .md files 未索引。请移入 mounted store；非 store knowledge root 已退休。",
  "doctor.check.knowledge_dir_unindexed.remediation":
    "使用 `fabric store bind` / `fabric store switch-write`，然后把 knowledge 迁入 store 的 knowledge/ tree。",
  "doctor.check.knowledge_dir_unindexed.ok":
    "无需执行 legacy local knowledge 索引动作。",
  // v2.0.0-rc.33 W3-2 (T6 #27): 走 fabric-review modify 流程让 canonical id allocator 重新分配, 而非让用户自己选 id (易撞 counter, 难手算)。
  "doctor.check.counter_desync.name": "知识计数器失同步",
  "doctor.check.counter_desync.message.singular":
    "{count} 个 knowledge counter 与观测到的 stable_ids 不同步。{counterPath} = {current}，但检测到 {observedId}。运行 `fabric doctor --fix` bump counters。",
  "doctor.check.counter_desync.message.plural":
    "{count} 个 knowledge counters 与观测到的 stable_ids 不同步。{counterPath} = {current}，但检测到 {observedId}。运行 `fabric doctor --fix` bump counters。",
  "doctor.check.counter_desync.remediation":
    "运行 `fabric doctor --fix` 将 agents.meta.json counters 提升到观测到的最大 counter 值。",
  "doctor.check.counter_desync.ok":
    "agents.meta.json counters envelope 与观测到的 stable_ids 一致。",
  "doctor.check.store_counter_drift.name": "Store 计数器漂移",
  "doctor.check.store_counter_drift.message.singular":
    "{count} 个 store counter 低于磁盘上的最大 stable_id（{detail}）。该 store 下一次铸号会复用已存在的 id。运行 `fabric doctor --fix` 将 store counters.json 提升到磁盘最大值。",
  "doctor.check.store_counter_drift.message.plural":
    "{count} 个 store counter 低于磁盘上的最大 stable_id（{detail}）。这些 store 下一次铸号会复用已存在的 id。运行 `fabric doctor --fix` 将 store counters.json 提升到磁盘最大值。",
  "doctor.check.store_counter_drift.remediation":
    "运行 `fabric doctor --fix` 将每个 store 的 counters.json 提升（floor）到磁盘上观测到的最大 stable_id（floor 只升不降——KT-DEC-0004 单调不变量）。",
  "doctor.check.store_counter_drift.ok":
    "read-set 内每个 store 的 counters.json 都已 floor 到磁盘最大 stable_id。",
  "doctor.check.store_orphan.name": "Store 孤儿",
  "doctor.check.store_orphan.message.singular":
    "{count} 个 store 在磁盘上存在但未登记到全局 registry（{detail}），recall / bind 都看不到它。运行 `fabric doctor --fix` 把它收编（重新登记，绝不删除磁盘文件）。",
  "doctor.check.store_orphan.message.plural":
    "{count} 个 store 在磁盘上存在但未登记到全局 registry（首个：{detail}），recall / bind 都看不到它们。运行 `fabric doctor --fix` 把它们收编（重新登记,绝不删除磁盘文件）。",
  "doctor.check.store_orphan.remediation":
    "运行 `fabric doctor --fix` 把这些孤儿 store 收编进 registry(按 store_uuid 重新登记、alias 撞库自动消歧;rescue-before-delete——只登记不删盘)。",
  "doctor.check.store_orphan.ok":
    "~/.fabric/stores 下没有未登记的孤儿 store。",
  // W2 (F-003): 项目注册表漂移 —— projects.json ↔ projects/ 文件夹树。
  "doctor.check.project_registry_drift.name": "项目注册表漂移",
  "doctor.check.project_registry_drift.ok":
    "每个 knowledge/projects/<id>/ 文件夹都已在 projects.json 注册,且没有已注册文件夹为空。",
  "doctor.check.project_registry_drift.message.unregistered":
    "{total} 处项目注册表漂移:{breakdown}。例如 store '{storeAlias}' 的 projects/{projectId}/ 有知识条目但未在 projects.json 注册(写入未路由)。运行 `fabric doctor --fix` 补登记(rescue-before-delete——从不删文件夹)。",
  "doctor.check.project_registry_drift.message.orphan":
    "{total} 处项目注册表漂移:{breakdown}。例如 store '{storeAlias}' 的 projects/{projectId}/ 磁盘存在但未在 projects.json 注册。运行 `fabric doctor --fix` 补登记(rescue——从不删文件夹)。",
  "doctor.check.project_registry_drift.message.empty":
    "{total} 处项目注册表漂移:{breakdown}。例如 store '{storeAlias}' 已注册项目 '{projectId}' 的 projects/{projectId}/ 文件夹为空(零条目)。运行 `fabric doctor --fix` 清理空文件夹。",
  "doctor.check.project_registry_drift.remediation":
    "运行 `fabric doctor --fix` 对账:orphan / 未注册写入的文件夹会被 rescue-register 进 projects.json(即使非空也从不删除);仅真正为空的已注册文件夹才被清理。ghost 注册(已注册 id 但无文件夹)是合法的(lazy 创建),无需处理。",
  "doctor.check.preexisting_root_files.name": "预存根目录 markdown",
  "doctor.check.preexisting_root_files.ok": "project root 未检测到 CLAUDE.md 或 AGENTS.md。",
  "doctor.check.preexisting_root_files.message":
    "project root 检测到 {files}。这些 root files 不会被 Fabric MCP 自动加载。",
  "doctor.check.preexisting_root_files.remediation":
    "如果希望这些 knowledge 内容在 MCP 响应中可用，请将其移动到 mounted store 的 `knowledge/{type}/` tree。",
  // v2.0.0-rc.33 W3-2 (T6 #34): 同 stable_id_collision — 走 fabric-review modify 让 allocator 分配新 id, 不让用户手算。
  // v2.0.0-rc.33 W3-2 (T6 #35): 加 skill 入口 (`/fabric-review modify <id>`) 让用户知道怎么 invoke。
  "doctor.check.index_drift.name": "知识索引漂移",
  "doctor.check.index_drift.ok":
    "agents.meta.json counters envelope 对每个 (layer, type) pair 都大于或等于现有 canonical counter 最大值。",
  "doctor.check.index_drift.message.singular":
    "{count} 个 (layer, type) counter slot 已低于观测到的 canonical maximum（next allocate would collide）。首个：{detail}。",
  "doctor.check.index_drift.message.plural":
    "{count} 个 (layer, type) counter slots 已低于观测到的 canonical maximum（next allocate would collide）。首个：{detail}。",
  "doctor.check.index_drift.remediation":
    "运行 `fabric doctor --fix` 将 agents.meta.json counters 提升到 max_observed + 1。",
  "doctor.check.underseeded.name": "知识种子不足",
  "doctor.check.underseeded.ok":
    "知识库已有 {count} 个 canonical entries（>= {threshold}）。",
  "doctor.check.underseeded.message.singular":
    "知识库仅有 {count} 个 canonical entry（< {threshold} threshold）。plan_context 检索面低于可用下限。",
  "doctor.check.underseeded.message.plural":
    "知识库仅有 {count} 个 canonical entries（< {threshold} threshold）。plan_context 检索面低于可用下限。",
  "doctor.check.underseeded.remediation":
    "运行 fabric-archive skill 的 source mode（`/fabric-archive`）从 git history 与现有文档回填 knowledge。",
  "doctor.check.session_hints_stale.name": "知识 session-hints 陈旧",
  "doctor.check.session_hints_stale.ok":
    ".fabric/.cache/ 下没有超过 {days} 天的 session-hints cache files。",
  "doctor.check.session_hints_stale.message.singular":
    ".fabric/.cache/ 下有 {count} 个 session-hints cache file 超过 {days} 天。首个：{detail}。",
  "doctor.check.session_hints_stale.message.plural":
    ".fabric/.cache/ 下有 {count} 个 session-hints cache files 超过 {days} 天。首个：{detail}。",
  "doctor.check.session_hints_stale.remediation":
    "运行 `fabric doctor --fix` 删除过期的 session-hints cache files。",
  "doctor.check.hook_cache_writable.name": "Hook 缓存可写",
  "doctor.check.hook_cache_writable.ok":
    "Hook sidecar cache 路径 {path} 可写入探针文件。",
  "doctor.check.hook_cache_writable.message":
    "Hook sidecar cache 路径 {path} 不可写；hook state updates 会静默失败。错误：{error}。",
  "doctor.check.hook_cache_writable.remediation":
    "恢复 {path} 写权限，移除占用该路径的阻塞文件，或修复文件系统状态后重新运行 `fabric install`。",
  "doctor.check.stale_serve_lock.name": "Serve 锁",
  "doctor.check.stale_serve_lock.ok.no_lock": "未发现 .fabric/.serve.lock。",
  "doctor.check.stale_serve_lock.ok.live_pid":
    ".fabric/.serve.lock 由 live PID {pid} 持有。",
  "doctor.check.stale_serve_lock.age.day.singular": "{count} 天前",
  "doctor.check.stale_serve_lock.age.day.plural": "{count} 天前",
  "doctor.check.stale_serve_lock.age.hour.singular": "{count} 小时前",
  "doctor.check.stale_serve_lock.age.hour.plural": "{count} 小时前",
  "doctor.check.stale_serve_lock.message.dead_pid":
    "[advisory] .fabric/.serve.lock 持有 dead PID {pid}（acquired {acquiredAgo}）。运行 `fabric doctor --fix` 移除。",
  "doctor.check.stale_serve_lock.remediation.dead_pid":
    "运行 `fabric doctor --fix` 移除过期的 .fabric/.serve.lock。",
  // rc.31 BUG-M3/NEW-4: hooks_wired observability.
  "doctor.check.hooks_wired.name": "Claude Code hooks 注入",
  "doctor.check.hooks_wired.ok.skipped": "项目未启用 Claude Code（无 .claude/ 目录）；跳过 hooks_wired 检查。",
  "doctor.check.hooks_wired.ok.wired":
    ".claude/settings.json 已注入 Stop:fabric-hint / SessionStart:knowledge-hint-broad / PreToolUse:knowledge-hint-narrow 三个 fabric hook。",
  "doctor.check.hooks_wired.message.missing_settings":
    ".claude/ 目录存在但 .claude/settings.json 缺失或无法解析；fabric install 可能从未跑成功，或文件被外部清空。",
  "doctor.check.hooks_wired.message.incomplete":
    ".claude/settings.json 缺少 fabric hook 注入：{missing}。fabric install 的 dry-run 报告与实际状态不一致（rc.30 audit BUG-M3 / NEW-4）。",
  "doctor.check.hooks_wired.remediation":
    "运行 `fabric install` 重新注入 hooks（幂等；只补缺失项）。若意外覆盖了 hooks 配置，先备份 .claude/settings.json 再跑。",
  // v2.0.0-rc.37 NEW-20: hooks_runtime — shebang + Node.js syntax validity
  // of installed *.cjs hook files (one layer below hooks_wired).
  "doctor.check.hooks_runtime.name": "Hooks 运行时健康",
  "doctor.check.hooks_runtime.ok.skipped": "未发现已安装的 hook 文件（.claude/hooks/ / .codex/hooks/ 都缺）；跳过 hooks_runtime 检查。",
  "doctor.check.hooks_runtime.ok.healthy":
    "已扫描 {count} 个 hook .cjs 文件，shebang 与 Node.js 语法解析全部通过。",
  "doctor.check.hooks_runtime.message.singular":
    "{count} 个 hook 文件 runtime 不健康；首例：{first_path}（{first_detail}）。",
  "doctor.check.hooks_runtime.message.plural":
    "{count} 个 hook 文件 runtime 不健康；首例：{first_path}（{first_detail}）。",
  "doctor.check.hooks_runtime.remediation":
    "运行 `fabric install` 重写损坏的 hook 文件（覆盖式，幂等）。若文件是被外部进程破坏的，确认源头再跑 install。",
  // v2.0.0-rc.37 NEW-27: hooks_content_drift — cross-client sha256 parity.
  "doctor.check.hooks_content_drift.name": "Hooks 跨客户端内容一致性",
  "doctor.check.hooks_content_drift.ok.skipped": "未发现跨客户端共存的 hook 文件（单 client 安装或全部缺失）；跳过 hooks_content_drift 检查。",
  "doctor.check.hooks_content_drift.ok.aligned":
    "已扫描 {count} 个 hook 副本，跨 client (.claude / .codex) sha256 全部一致。",
  "doctor.check.hooks_content_drift.message":
    "{count} 个 hook basename 在 client 之间内容 drift；首例：{first_basename}（涉及 {first_clients}）。`fabric install` 复制同一模板到三 client，drift 通常来自手动编辑。",
  "doctor.check.hooks_content_drift.remediation":
    "运行 `fabric install` 把所有 client 的 hook 副本恢复到 canonical 模板。若你确实需要 client-specific hook 行为，建议改 lib/ 共享脚本或 templates/hooks/configs/ 配置而非直接编辑安装后的 .cjs。",
  // rc.31 BUG-G2/G5: promote-ledger invariant check.
  "doctor.check.promote_ledger_invariant.name": "晋升账本不变量",
  "doctor.check.promote_ledger_invariant.ok":
    "knowledge_proposed={proposed} ≥ knowledge_promote_started={started} ≥ knowledge_promoted={promoted}，ledger 不变量持有。",
  "doctor.check.promote_ledger_invariant.message.proposed-lt-started":
    "knowledge_proposed={proposed} 小于 knowledge_promote_started={started}（ledger 不变量被破坏；部分 pending 在 approve 时未经过 fab_propose → 缺少 propose 事件）。",
  "doctor.check.promote_ledger_invariant.message.started-lt-promoted":
    "knowledge_promote_started={started} 小于 knowledge_promoted={promoted}（ledger 不变量被破坏；存在未配对的 promoted 事件，可能来自 doctor filesystem-edit fallback 或外部写入）。",
  "doctor.check.promote_ledger_invariant.remediation":
    "rc.31 起 review.approve 会补发 knowledge_proposed 事件以维护不变量；新 approve 后再跑一次 fabric doctor 即可恢复。历史失衡仅是可观测性指示，不影响 KB 功能。",
  // rc.35 TASK-04 (P0-9.b): global_cli_outdated.
  "doctor.check.global_cli_outdated.name": "全局 fabric CLI 版本",
  "doctor.check.global_cli_outdated.ok":
    "PATH 上的 `fabric` 是 {version}，与 rc.31+ 项目 schema 兼容。",
  "doctor.check.global_cli_outdated.message.outdated":
    "PATH 上的 `fabric` 是 {version}，低于最低支持版本 {minVersion}。rc.31 修复了 agents.meta.json schema，旧版 CLI 安装的 hook 会静默失效，必须升级。",
  "doctor.check.global_cli_outdated.message.not_found":
    "PATH 上找不到 `fabric` 二进制。`fabric install` / `fabric doctor` 都依赖它，请先全局安装。",
  "doctor.check.global_cli_outdated.message.unparseable":
    "无法解析 `fabric -v` 输出（{detail}），跳过版本检查。",
  "doctor.check.global_cli_outdated.remediation":
    "运行 `npm install -g @fenglimg/fabric-cli@latest`，然后到每个 fabric-managed 项目下重跑 `fabric install` 同步 hook + SKILL.md。",
  // rc.35 TASK-05 (P0-10.a): knowledge_summary_opaque.
  "doctor.check.knowledge_summary_opaque.name": "知识 summary 透明度",
  "doctor.check.knowledge_summary_opaque.ok.skipped":
    "agents.meta.json 缺失或无效，跳过 summary 透明度检查。",
  "doctor.check.knowledge_summary_opaque.ok":
    "{opaque}/{total} 个 entry 的 summary == stable_id，比例在健康范围内。",
  "doctor.check.knowledge_summary_opaque.message.warn":
    "{opaque}/{total} 个 entry ({pct}%) 的 description.summary 等于 stable_id，超过 {threshold}% 阈值。narrow hint 输出会变成 `<id> · <id>` 而非真实概要，AI 看不到信息会主动跳过 fetch。首批不透明: {sample}。",
  "doctor.check.knowledge_summary_opaque.remediation":
    "调 fabric-review skill 重写不透明 summary 为一句人类可读的概要。rc.35 hint renderer fallback (TASK-06) 也会从 entry 的 `## Summary` 段自动合成临时 summary。",
  // v2.2 W4 (G-GUARD / A6): store scope lint。
  "doctor.check.store_scope_lint.name": "Store scope 检查",
  "doctor.check.store_scope_lint.ok":
    "read-set 内所有 store 条目 scope 元数据齐备(semantic_scope + visibility_store,无 personal 泄漏,无 dangling project)。",
  "doctor.check.store_scope_lint.message":
    "{total} 个 store scope 问题: {breakdown}。例如 {sample}。",
  "doctor.check.store_scope_lint.remediation":
    "调 `fabric store migrate backfill` 补缺失的 semantic_scope/visibility_store;`fabric store migrate scope` 修 dangling 的 project: 坐标;把 personal-scope 条目移出 shared store(personal 知识只存个人 store,R5#3)。",
  // v2.2 Goal B (G-INTEGRITY): store stable_id collision + layer mismatch lints。
  "doctor.check.stable_id_collision.name": "Stable ID 冲突",
  "doctor.check.stable_id_collision.message.singular":
    "stable_id \"{stableId}\" 被声明在 {fileCount} 个文件中:{files}。请编辑其中一个 knowledge file,改用唯一 stable_id。",
  "doctor.check.stable_id_collision.message.plural":
    "检测到 {count} 个 stable_id collisions。首个:\"{stableId}\" 位于 {files}。请编辑其中一个 knowledge file,改用唯一 stable_id。",
  "doctor.check.stable_id_collision.remediation":
    "调 `/fabric-review modify <message 中列出的 colliding id 之一>`, 让 canonical id allocator 自动重分配 id (会同步更新 frontmatter + counters + 历史 cross-ref)。严禁手工编辑 id frontmatter — 会撞 counter。",
  "doctor.check.stable_id_collision.ok":
    "mounted store knowledge 中未发现已声明的 stable_id collisions。",
  "doctor.check.layer_mismatch.name": "知识 layer 不匹配",
  "doctor.check.layer_mismatch.ok":
    "所有 canonical knowledge files 都位于 stable_id prefix 声明的 layer 下。",
  "doctor.check.layer_mismatch.message.singular":
    "{count} 个 canonical knowledge file 与其 stable_id layer prefix 的物理位置不一致(KT-* must live under team/, KP-* under personal/)。首个:{detail}。",
  "doctor.check.layer_mismatch.message.plural":
    "{count} 个 canonical knowledge files 与其 stable_id layer prefix 的物理位置不一致(KT-* must live under team/, KP-* under personal/)。首个:{detail}。",
  "doctor.check.layer_mismatch.remediation":
    "将文件移动到正确的 write-target store,或调 `/fabric-review modify <message 中列出的 id>` 切换其 layer (会相应重命名 stable_id prefix)。",
  // v2.2 Goal B (G-RELEVANCE): store relevance_paths hygiene (dangling + drift)。
  "doctor.check.relevance_paths_dangling.name": "知识 relevance_paths 悬空",
  "doctor.check.relevance_paths_dangling.ok":
    "所有 relevance_paths globs 都能在 workspace root 下解析到至少 1 个文件。",
  "doctor.check.relevance_paths_dangling.message.singular":
    "{count} 个 relevance_paths glob 在当前 workspace 中解析到 0 个文件。首个:{detail}。",
  "doctor.check.relevance_paths_dangling.message.plural":
    "{count} 个 relevance_paths globs 在当前 workspace 中解析到 0 个文件。首个:{detail}。",
  "doctor.check.relevance_paths_dangling.remediation":
    "更新 entry 的 relevance_paths,移除不再匹配任何文件的 globs,或使用 `fab_review.modify` 重写 anchor set。",
  "doctor.check.relevance_paths_drift.name": "知识 relevance_paths 漂移",
  "doctor.check.relevance_paths_drift.ok.skipped":
    "已跳过(git history unavailable;无法评估 {windowDays}d drift window)。",
  "doctor.check.relevance_paths_drift.ok.fresh":
    "所有 narrow-scope canonical entries 都至少有 1 个 relevance_path 在最近 {windowDays}d 内被触碰。",
  "doctor.check.relevance_paths_drift.message.singular":
    "{count} 个 narrow-scope canonical entry 的 relevance_paths globs 没有匹配到最近 {windowDays}d git history 中触碰过的文件。首个:{detail}。",
  "doctor.check.relevance_paths_drift.message.plural":
    "{count} 个 narrow-scope canonical entries 的 relevance_paths globs 没有匹配到最近 {windowDays}d git history 中触碰过的文件。首个:{detail}。",
  "doctor.check.relevance_paths_drift.remediation":
    "审阅该 entry 是否仍然相关 — 使用 `fab_review.modify` 刷新 anchors,或使用 `fab_review.reject` 归档。",
  "doctor.check.relevance_paths_drift.remediation_with_sample": "审阅该 entry 是否仍然相关 — 样本 {sample};使用 `fab_review.modify` 刷新 anchors,或使用 `fab_review.reject` 归档。",
  // W4-3 (KT-MOD-0001): narrow scope 但 relevance_paths 为空。
  "doctor.check.narrow_no_paths.name": "知识 narrow scope 缺路径",
  "doctor.check.narrow_no_paths.ok":
    "每条 narrow scope canonical entry 都至少带一个 relevance_path。",
  "doctor.check.narrow_no_paths.message.singular":
    "{count} 条 narrow scope entry 的 relevance_paths 为空 — 永远无法路径匹配,因此永不浮出(死条目)。首条: {detail}。",
  "doctor.check.narrow_no_paths.message.plural":
    "{count} 条 narrow scope entry 的 relevance_paths 为空 — 永远无法路径匹配,因此永不浮出(死条目)。首条: {detail}。",
  "doctor.check.narrow_no_paths.remediation":
    "用 `fab_review.modify` 补 relevance_paths glob 锚定该 entry,或若本意是常驻则把 relevance_scope 改为 `broad`。",
  // W4-2 (KT-DEC-0028): 单 store broad 索引接近 backstop。
  "doctor.check.broad_index_drift.name": "知识 broad 索引漂移",
  "doctor.check.broad_index_drift.ok":
    "没有 store 的 broad scope 条目数达到漂移阈值({threshold},backstop {backstop} 的 80%)。",
  "doctor.check.broad_index_drift.message.singular":
    "{count} 个 store 的 broad 索引已达 {threshold}(backstop {backstop} 的 80%) — SessionStart banner 接近截断 broad 条目。首条: {detail}。",
  "doctor.check.broad_index_drift.message.plural":
    "{count} 个 store 的 broad 索引已达 {threshold}(backstop {backstop} 的 80%) — SessionStart banner 接近截断 broad 条目。首条: {detail}。",
  "doctor.check.broad_index_drift.remediation":
    "跑 `fabric-review` skill 的 retire 子流程在告警 store 内 prune/降级陈旧 broad 条目,或若语料确实大则在 .fabric/fabric-config.json 调高 `broad_index_backstop`。",
  // v2.2 Goal B (G-AGE): knowledge decay lints (orphan_demote + stale_archive)。
  "doctor.check.orphan_demote.name": "知识孤儿降级",
  "doctor.check.orphan_demote.ok":
    "没有 canonical knowledge entries 超过按 maturity 设定的 inactivity threshold。",
  "doctor.check.orphan_demote.message.singular":
    "{count} 个 canonical knowledge entry 超过按 maturity 设定的 inactivity threshold(proven={provenDays}d / verified={verifiedDays}d / draft={draftDays}d)。首个:{detail}。",
  "doctor.check.orphan_demote.message.plural":
    "{count} 个 canonical knowledge entries 超过按 maturity 设定的 inactivity threshold(proven={provenDays}d / verified={verifiedDays}d / draft={draftDays}d)。首个:{detail}。",
  "doctor.check.orphan_demote.remediation":
    "通过 `/fabric-review modify <id>` 将该 entry 降级一个 maturity tier,或重新使用它以记录新活动。(改写 store 知识是 store 写侧流程的职责 — 这个读侧 lint 只负责暴露衰减。)",
  "doctor.check.stale_archive.name": "知识陈旧归档",
  "doctor.check.stale_archive.ok":
    "没有 draft knowledge entries 超过额外的 stale-archive quiet window。",
  "doctor.check.stale_archive.message.singular":
    "{count} 个 draft knowledge entry 已超过 demote+{additionalDays}d 额外 quiet window。首个:{detail}。",
  "doctor.check.stale_archive.message.plural":
    "{count} 个 draft knowledge entries 已超过 demote+{additionalDays}d 额外 quiet window。首个:{detail}。",
  "doctor.check.stale_archive.remediation":
    "通过 `/fabric-review reject <id>` 归档该 stale draft,或若仍相关则复活它。(移动 store 文件是 store 写侧流程的职责 — 这个读侧 lint 只负责暴露陈旧。)",
  // v2.2 C1: knowledge promotion lint (promotion_candidate, info kind)。
  "doctor.check.promotion_candidate.name": "知识晋升候选",
  "doctor.check.promotion_candidate.ok":
    "没有 verified knowledge entries 达到 proven 晋升的 related 入度门槛。",
  "doctor.check.promotion_candidate.message.singular":
    "{count} 个 verified knowledge entry 的 related 入度 ≥{threshold},结构上够中心,值得 review 晋升到 proven。首个:{detail}。",
  "doctor.check.promotion_candidate.message.plural":
    "{count} 个 verified knowledge entries 的 related 入度 ≥{threshold},结构上够中心,值得 review 晋升到 proven。首个:{detail}。",
  "doctor.check.promotion_candidate.remediation":
    "通过 `/fabric-review` 复核这些 entry,确认 0 dismiss、cold-eval 自足、属地基级后 `modify <id>` 升到 proven。(晋升判定是 store 写侧 review 的职责 — 这个读侧 lint 只 surface 结构中心的候选。)",
  // v2.2 C1: broad review-recheck lint (broad_review_recheck, info kind)。
  "doctor.check.broad_review_recheck.name": "知识 broad review 复查",
  "doctor.check.broad_review_recheck.ok":
    "没有 broad-scope knowledge entries 超期未做 review 再确认。",
  "doctor.check.broad_review_recheck.message.singular":
    "{count} 个 broad-scope knowledge entry 已 {thresholdDays}d+ 没经过 fab-review 再确认,值得复查(broad 豁免 usage-age 降级,这是它的 review 时钟)。首个:{detail}。",
  "doctor.check.broad_review_recheck.message.plural":
    "{count} 个 broad-scope knowledge entries 已 {thresholdDays}d+ 没经过 fab-review 再确认,值得复查(broad 豁免 usage-age 降级,这是它的 review 时钟)。首个:{detail}。",
  "doctor.check.broad_review_recheck.remediation":
    "通过 `/fabric-review` 再确认每条(approve/modify 会盖一个新的 review 时间戳),或若不再成立则降级/驳回。这是非阻塞提示,绝不自动降级 — broad 知识在 reviewer 动手前持续 surface。",
  // project-scope binding 回填 lint (unbound_project)。
  "doctor.check.unbound_project.name": "Project-scope 绑定",
  "doctor.check.unbound_project.ok":
    "已绑写入 store 带有 project 坐标(project_id + active_project),project-scope 的 recall/写入路由正常。",
  "doctor.check.unbound_project.message":
    "store '{alias}' 已绑为写入目标但 project 坐标不完整(缺 {missing});project-scope 的 recall/写入会 fallback 到 team scope。",
  "doctor.check.unbound_project.remediation":
    "调 `fabric doctor --fix` 回填 project 绑定(铸 project_id、把 project 注册进 store、设 active_project)。幂等 —— 二次跑为 no-op。",
  // write_route_target_unbound — 单 team 槽迁移后 write_routes 悬空的静态检查。
  "doctor.check.write_route_target_unbound.name": "写入路由目标",
  "doctor.check.write_route_target_unbound.ok":
    "所有 write_routes 的目标 store 都在 required_stores 内,scope→store 路由静态一致。",
  "doctor.check.write_route_target_unbound.message":
    "{count} 条 write_route 指向未绑定的 store({routes});fab_propose 在这些 scope 上会报 \"no write-target store resolved\"。",
  "doctor.check.write_route_target_unbound.remediation":
    "二选一:① `fabric store bind <store>` 把目标 store 加进 required_stores(单 team 槽 = 需替换掉当前的),或 ② 编辑 `.fabric/fabric-config.json` 删掉这条 write_route。",
  // stray_fabric_dir_detected — rc.11 root-cause fix: server-side resolveProjectRoot 之前用 cwd,
  // 从子目录起的子进程会把 .fabric/ 建在错误的路径。此 lint 扫描项目树,找出 <root>/.fabric 之外的所有 .fabric/。
  "doctor.check.stray_fabric_dir_detected.name": "游离 .fabric 目录",
  "doctor.check.stray_fabric_dir_detected.ok":
    "项目下未发现游离 .fabric 目录,唯一权威根 .fabric 就是 <projectRoot>/.fabric。",
  "doctor.check.stray_fabric_dir_detected.message":
    "发现 {count} 个游离 .fabric 目录({dirs}),它们是子进程在子目录被误认作 project root 的历史遗留(rc.10 之前的 hook / rc.11 之前的 server 侧),会导致 events.jsonl / metrics.jsonl / .cache 散落。",
  "doctor.check.stray_fabric_dir_detected.remediation":
    "跑 `fabric doctor --fix` 会把每个游离 dir 改名为 `.fabric.stale-<timestamp>`(rescue-before-delete,不硬删)。改名后可人工核对是否需要合并 events 再删。同时升级本机 fabric-cli 至 rc.11+ 让 server 侧 git-anchor 生效。",
  "doctor.check.skill_md_yaml_invalid.name": "Skill markdown YAML",
  "doctor.check.skill_md_yaml_invalid.ok":
    "所有 .claude/.codex SKILL.md frontmatter values 都能按 strict YAML 解析。",
  "doctor.check.skill_md_yaml_invalid.message.singular":
    "{count} 个 SKILL.md frontmatter value 包含未加引号的 ': '，strict YAML parsers 会拒绝（Claude Code tolerates it；Codex CLI drops the skill at load）。首个：{detail}。",
  "doctor.check.skill_md_yaml_invalid.message.plural":
    "{count} 个 SKILL.md frontmatter values 包含未加引号的 ': '，strict YAML parsers 会拒绝（Claude Code tolerates it；Codex CLI drops the skill at load）。首个：{detail}。",
  "doctor.check.skill_md_yaml_invalid.remediation":
    "使用双引号包裹该 value（`description: \"…\"`），或将内部的 `key: value` token 改写为 `key=value`。",
  "doctor.check.onboard_coverage.name": "Onboard 覆盖率",
  "doctor.check.onboard_coverage.ok.complete":
    "Onboard coverage：{filledCount}/{total} ✓（opted-out：{optedOutCount}）。",
  "doctor.check.onboard_coverage.message.incomplete":
    "尚未覆盖的 onboard slots：[{missingSlots}]。{filledCount}/{total} filled；{optedOutCount} opted-out。",
  "doctor.check.onboard_coverage.remediation.incomplete":
    "运行 /fabric-archive 执行 onboard — Skill's first-run phase 会遍历项目，并为每个 unclaimed slot 提议 pending entries。",
  // v2.0.0-rc.25 TASK-10: --archive-history 子命令——按 session 维度审计归档尝试记录。
  "cli.doctor.args.archive-history.description":
    "按 session 维度渲染归档尝试历史(只读;读取 session_archive_attempted 事件)。",
  "cli.doctor.errors.archive-history-mutex":
    "--archive-history 不能与 --fix / --fix-knowledge / --cite-coverage / --enrich-descriptions 同时使用,请分别运行。",
  "doctor.archive-history.header": "归档历史(最近 {sinceLabel},{count} 个会话)",
  "doctor.archive-history.empty": "暂无归档历史记录 (--since={sinceLabel} 窗口内)。",
  "doctor.archive-history.table.session": "会话",
  "doctor.archive-history.table.lastAttempt": "最近尝试",
  "doctor.archive-history.table.outcome": "结果",
  "doctor.archive-history.table.candidates": "候选数",
  "doctor.archive-history.table.coveredGap": "覆盖距今",
  // rc.37 NEW-33: 统一 --history <mode> 视图 (archive | fix | all)。
  "cli.doctor.args.history.description":
    "渲染统一的逐日 doctor / archive 历史 (mode: archive | fix | all)。只读;与 --fix / --fix-knowledge / --cite-coverage / --enrich-descriptions / --archive-history 互斥。",
  "cli.doctor.errors.history-mutex":
    "--history 不能与 --fix / --fix-knowledge / --cite-coverage / --enrich-descriptions / --archive-history 组合。请分别运行。",
  "cli.doctor.errors.invalid-history-mode":
    "无效的 --history mode '{input}'。可选: archive | fix | all。",
  "doctor.history.header": "Doctor 历史 (mode={mode}, 近 {sinceLabel}, 共 {days} 天)",
  "doctor.history.empty": "--since={sinceLabel} 窗口内无 doctor 或 archive 活动 (mode={mode})。",

  "cli.install.description":
    "在目标项目中安装 Fabric（脚手架 .fabric/、bootstrap 模板、MCP 客户端配置、git hooks）",
  "cli.install.args.target.description":
    "目标项目路径。默认依次使用 --target、EXTERNAL_FIXTURE_PATH、当前目录。",
  "cli.install.args.debug.description": "将目标解析细节输出到 stderr。",
  "cli.install.args.yes.description": "接受当前安装计划并跳过 TTY 向导直接执行",
  "cli.install.args.dry-run.description": "仅输出安装计划，不写文件也不执行后续阶段",
  "cli.install.args.enable-embed.description":
    "启用向量语义搜索 (设 embed_enabled + embed_model;打印 fastembed 安装步骤)",
  "cli.install.args.embed-model.description":
    "配合 --enable-embed:覆盖固定的 embed 模型 (默认 fast-bge-small-zh-v1.5)",
  "cli.install.args.global.description":
    "配置全局 Fabric (~/.fabric:uid + personal store + 配置)",
  "cli.install.args.url.description":
    "克隆并挂载一个共享 store 远程库。项目安装时:同时绑定到本项目并设为写入目标。配合 --global:仅挂载到本机。",
  // TASK-004: --verbose 展开重装折叠的逐 phase 明细 + 完整客户端能力表。
  "cli.install.args.verbose.description":
    "展开完整明细:重装幂等时不折叠为体检卡片,并打印逐客户端能力表",
  // rc.35 TASK-08 (P0-5/6): --force-skills-only。
  "cli.install.args.force-skills-only.description":
    "跳过 bootstrap / MCP / hooks / settings,只重新刷新 fabric Skill 模板 (.claude/.codex/skills/*)。",
  "cli.install.force-skills-only.banner": "只刷新 fabric Skill 模板",
  "cli.install.force-skills-only.uninitialised.message":
    "fabric install --force-skills-only: 项目未初始化(找不到 .fabric/agents.meta.json)。",
  "cli.install.force-skills-only.uninitialised.hint":
    "请先运行 `fabric install`(不带 --force-skills-only)铺设基础 scaffold;之后再用 --force-skills-only 做后续 Skill 刷新。",
  "cli.install.force-skills-only.summary": "Skill 刷新完成 — 写入: {written}, 跳过: {skipped}, 错误: {errors}",
  // v2.0.0-rc.37 NEW-26: --force-hooks-only mirror of --force-skills-only。
  "cli.install.args.force-hooks-only.description":
    "跳过 bootstrap / MCP / skills / settings,只重新刷新 fabric hook scripts + per-client hook config 合并 (.claude/.codex/hooks/*)。",
  "cli.install.force-hooks-only.banner": "只刷新 fabric hooks",
  "cli.install.force-hooks-only.uninitialised.message":
    "fabric install --force-hooks-only: 项目未初始化(找不到 .fabric/agents.meta.json)。",
  "cli.install.force-hooks-only.uninitialised.hint":
    "请先运行 `fabric install`(不带 --force-hooks-only)铺设基础 scaffold;之后再用 --force-hooks-only 做后续 hook 刷新。",
  "cli.install.force-hooks-only.summary": "Hooks 刷新完成 — 写入: {written}, 跳过: {skipped}, 错误: {errors}",
  "cli.install.mcp.install.global": "使用全局安装的 @fenglimg/fabric-server",
  "cli.install.mcp.install.local": "将 @fenglimg/fabric-server 安装到项目 devDependencies",
  "cli.install.mcp.local.installing": "正在运行 {manager} add -D @fenglimg/fabric-server...",
  "cli.install.mcp.local.installed": "已安装到 devDependencies",
  "cli.install.mcp.scope.project": "写入项目根目录的 .mcp.json（符合 Claude Code 规范）",
  "cli.install.mcp.scope.user": "写入 ~/.claude.json（用户范围，适用于所有项目）",
  "cli.install.wizard.mcp-scope": "Claude MCP 配置范围（project/.mcp.json 或 user/~/.claude.json）[{defaultValue}]",
  "cli.install.created-path": "{label} {path}",
  "cli.install.skipped-existing-path": "{label} {path}：已存在。",
  "cli.install.label.overwritten": "已覆盖",
  "cli.install.stages.bootstrap": "正在安装 bootstrap 模板...",
  "cli.install.stages.bootstrap.snapshot.written": "已写入 .fabric/AGENTS.md 快照",
  "cli.install.stages.bootstrap.snapshot.skipped": "已跳过 .fabric/AGENTS.md — 已是最新",
  "cli.install.steps.bootstrap-claude": "已更新 CLAUDE.md 的 @-import 引用",
  "cli.install.steps.bootstrap-codex": "已更新 AGENTS.md 的 fabric:bootstrap managed block",
  "cli.install.stages.mcp": "正在配置 MCP 客户端...",
  "cli.install.stages.hooks": "正在安装 hook 与 skill...",
  "cli.install.preflight.error.no-home": "无法确定 global root 的 home 目录",
  "cli.install.preflight.error.not-dir": "全局 Fabric root 不是目录: {path}",
  "cli.install.preflight.error.parent-not-dir": "全局 Fabric root 的父目录不是目录: {path}",
  "cli.install.preflight.error.not-writable": "{label} 不可写: {path} ({reason})",
  "cli.install.preflight.error.git-required": "--url 安装需要 git,但当前不可用: {reason}",
  "cli.install.preflight.label.target": "目标目录",
  "cli.install.preflight.label.global-root": "全局 Fabric root",
  "cli.install.preflight.label.global-root-parent": "全局 Fabric root 的父目录",
  "cli.install.guidance.more": "更多: docs/surfaces.md 说明何时用 CLI / Skill / MCP。",
  "cli.install.validate.passed": "安装校验通过 ✓(config / hooks 路径 / events 均就绪)",
  "cli.install.validate.failed": "安装校验失败:{count} 个问题",
  "cli.install.validate.failed-item": "  - {error}",
  "cli.install.hooks.uptodate": "hook 与 skill 已最新,无需改动({count} 项)",
  "cli.install.hooks.installed": "已装 skill×{skills} + hook×{hooks}",
  "cli.install.mcp.configured": "已配置 MCP:{clients}",
  "cli.install.mcp.none": "无需配置 MCP 客户端",
  "cli.install.scan.finding.framework": "检测到: {framework} 项目",
  "cli.install.scan.finding.scale": "规模: {files} 文件 · {entries} 个入口",
  // flat-design: 扫描结果合成一行人话(框架 + 规模);版本为 unknown 时隐去,
  // 没识别出框架时退到 plain。
  "cli.install.scan.summary.framework": "检测到 {framework} 项目 · {files} 文件 · {entries} 入口",
  "cli.install.scan.summary.plain": "扫描完成 · {files} 文件 · {entries} 入口",
  "cli.install.rollback.feedback": "已回滚 {count} 项改动,项目保持原状。",
  "cli.install.stages.skipped": "已跳过",
  "cli.install.stages.completed": "已完成",
  "cli.install.stages.failed": "失败",
  "cli.install.stages.summary.ran": "已执行",
  "cli.install.stages.summary.skipped": "已跳过",
  "cli.install.stages.summary.failed": "失败",
  "cli.install.pipeline.title": "Fabric 安装",
  "cli.install.pipeline.complete": "Fabric 安装完成",
  "cli.install.pipeline.running": "将按 {count} 个阶段执行",
  // TASK-002 (G1):总结卡收尾 + 计数词。原先在 ConsoleOutputRenderer 中硬编码英文
  // (Done! / succeeded / skipped / failed / "All steps completed successfully"),
  // 全部收进 t() + 双语表,locale-parity.test.ts 守护 en + zh-CN 每个 key 齐备。
  "cli.summary.done": "完成!",
  "cli.summary.all-ok": "全部步骤已完成",
  "cli.summary.n-failed": "{count} 个步骤失败",
  "cli.summary.all-resolved": "全部已处理 · {done} 执行 / {skipped} 跳过",
  "cli.summary.count.succeeded": "成功",
  "cli.summary.count.skipped": "跳过",
  "cli.summary.count.failed": "失败",
  // TASK-004: 首装走 onboarding 定调(欢迎语 + 一次性设置说明);重装保持简洁的
  // "将按 N 阶段执行"。{count} = 阶段总数。
  "cli.install.pipeline.intro.firstRun":
    "欢迎使用 Fabric —— 这是首次安装,我会引导你完成一次性设置(共 {count} 个阶段);之后再跑会自动跳过已就绪项。",
  // TASK-004: 重装且全程幂等(无任何 install)时折叠成的单张体检卡片标题。
  // {count} = 阶段总数。明细走 --verbose。
  "cli.install.healthcheck.title": "✓ Fabric 已是最新 · {count} 阶段就绪 · 无改动",
  // TASK-003 (G2 root a):每阶段总结明细的状态词改按 r.changed 判定(不再用
  // installed.length)—— 无改动的重装走"已最新",不再误报"N 项已安装"。
  // installed-count 仅在该阶段确有改动时使用。
  "cli.install.stage.uptodate": "已最新",
  "cli.install.stage.installed-count": "{count} 项已安装",
  // flat-design: 阶段标签收短,让 `● 名称  ✓` 列对齐、读着清爽(原全称偏长)。
  "cli.install.pipeline.label.preflight": "环境预检",
  "cli.install.pipeline.label.env": "环境初始化",
  "cli.install.pipeline.label.store": "知识库",
  "cli.install.pipeline.label.hooks": "Hook 与 skill",
  "cli.install.pipeline.label.mcp": "MCP 服务",
  "cli.install.pipeline.label.validate": "安装校验",
  "cli.install.pipeline.label.guidance": "后续指引",
  "cli.install.pipeline.desc.store": "绑定当前项目的 read/write store，刷新 resolved-bindings snapshot。",
  "cli.install.next-step": "{label} {message}",
  // TASK-002 (G6): 收口总结卡的单一黄金动作锚点。能力明细表收进 --verbose,
  // 这一行才是诚实的「下一步做什么」。{action} = 具体下一条命令。
  "cli.install.next-step.anchor": "下一步 → {action}",
  // flat-design (G6): 装完最该做的事是重启客户端让 MCP 生效 —— 这才是默认锚点动作;
  // --reapply 维护提示退到 --verbose。
  "cli.install.next-step.restart": "重启已开的 Claude Code / Codex 会话以加载 Fabric(新会话自动生效)。",
  "cli.install.reason-message": "{label} {message}",
  "cli.install.language.prompt": "选择 Fabric 语言（界面与知识统一使用，之后可用 fabric config 修改）：",
  "cli.install.language.option.zh-CN": "简体中文 (zh-CN)",
  "cli.install.language.option.en": "English (en)",
  "cli.install.plan.title": "Fabric 安装计划",
  "cli.install.plan.mode-banner.default": "[mode: apply] 标准安装执行",
  "cli.install.plan.mode-banner.plan": "[mode: plan] 仅预览，不会写入文件",
  "cli.install.plan.target": "目标：{target}",
  "cli.install.plan.actions": "计划：bootstrap={bootstrap} mcp={mcp} hooks={hooks} mcp-install={mcpInstall}",
  "cli.install.plan.detected": "检测到的客户端：{clients}",
  "cli.install.plan.writes": "核心写入：",
  "cli.install.plan.preview-title": "Fabric 安装 dry run",
  "cli.install.plan.preview-result": "模式={mode} bootstrap={bootstrap} mcp={mcp} hooks={hooks}",
  "cli.install.mode.default": "default",
  "cli.install.mode.badge.default": "APPLY",
  "cli.install.mode.badge.plan": "PLAN",
  "cli.install.wizard.title": "Fabric 安装向导",
  "cli.install.wizard.intro": "Fabric install",
  "cli.install.wizard.overview.title": "安装概览",
  "cli.install.wizard.overview.body": "目标：{target}\n模式：{mode}\n这个向导只负责调整安装计划；真正执行仍然走现有的 Fabric install 阶段。",
  "cli.install.wizard.step.target": "确认目标",
  "cli.install.wizard.step.plan": "配置安装计划",
  "cli.install.wizard.step.review": "复核最终计划",
  "cli.install.wizard.target.confirm": "确认在 {target} 中继续安装 Fabric？[Y/n]",
  "cli.install.wizard.stage.bootstrap": "是否安装 bootstrap 模板？[{defaultValue}]",
  "cli.install.wizard.stage.mcp": "是否配置 MCP 客户端？[{defaultValue}]",
  "cli.install.wizard.stage.hooks": "是否安装 git hooks？[{defaultValue}]",
  // flat-design-system Wave4 (TASK-004): post-group ✓ 回执用的短阶段标签。
  "cli.install.wizard.stage.bootstrap.short": "bootstrap 模板",
  "cli.install.wizard.stage.mcp.short": "MCP 客户端",
  "cli.install.wizard.stage.hooks.short": "git hooks",
  "cli.install.wizard.mcp-install": "MCP 服务端安装范围（global/local）[{defaultValue}]",
  "cli.install.wizard.execute.confirm": "现在执行该安装计划？[Y/n]",
  "cli.install.wizard.outro": "安装计划已确认，开始执行 Fabric install...",
  "cli.install.wizard.invalid-yes-no": "请输入 yes 或 no。",
  "cli.install.wizard.invalid-select": "无效输入。可选值：{options}。",
  "cli.install.wizard.cancelled": "Fabric 安装已在执行前取消。",
  "cli.install.capabilities.title": "客户端能力摘要",
  // C-006 (TASK-004):默认只打一行能力摘要,让收尾的 summary card 主导收口印象;
  // 完整 4×6 能力表只在 --verbose 下展开。{count} = 检测到的客户端数。
  "cli.install.capabilities.summaryLine": "已检测到 {count} 个客户端并完成能力配置(加 --verbose 查看逐客户端明细表)。",
  // v2.0.0-rc.37 NEW-22: post-install 重启提示。MCP server 在 client 启动
  // 时 spawn, 已运行的 Claude Code / Codex session 不会自动加载
  // 新 mcp config — 必须重启才能拿到 Fabric tools。
  "cli.install.restart-banner":
    "重启提示: 已运行的 Claude Code / Codex CLI session 需重启才能加载新 MCP server 配置;新会话会自动使用 Fabric tools。",
  "cli.install.next-steps":
    "下一步 —— 拿到第一份价值:\n" +
    "  1. 重启你的 AI 客户端 (Claude Code / Codex)。它现在会自动把本项目的知识 surface (主动呈现) 给助手。\n" +
    "  2. 沉淀知识: 正常干活即可 —— 当你做决策或踩坑时, fabric-archive skill 会提议入库; 或跑 fabric-archive skill 的 source mode 从 git 历史回灌。\n" +
    "  3. 验证生效: 问你的 AI「Fabric 对这个 repo 知道些什么?」, 或跑 `fabric doctor` 查健康。",
  "cli.install.store-bind-nudge":
    "💡 检测到已挂载但未绑定本项目的知识 store: {aliases}。运行 `fabric store bind {first}` 把它的知识接入本项目, 再 `fabric store switch-write {first}` 设为团队知识的写入目标。",
  // C1/C5: 语义搜索交互文案统一走 t()，英文术语首现加中文 gloss。
  "cli.install.semantic.prompt": "启用向量语义搜索 (vector semantic search)？(首次召回 recall 时才会下载嵌入模型)",
  "cli.install.semantic.enabled": "语义搜索已启用 (embed_enabled=true, embed_model={model})。",
  "cli.install.semantic.already-enabled": "语义搜索已是启用状态 (embed_model={model})，未改动 {path}。",
  "cli.install.semantic.offer-install": "现在安装可选的 embedder (向量编码器) 吗？将运行 `npm i -g fastembed`（已安装则秒过）。",
  "cli.install.semantic.installing": "正在运行 `npm i -g fastembed` …",
  "cli.install.semantic.installed": "fastembed 安装完成。嵌入模型会在首次召回 (recall) 时自动下载（约数十–数百 MB；不上传任何 KB 数据）。",
  "cli.install.semantic.install-failed": "自动安装失败（{reason}）。请手动执行下面的步骤：",
  "cli.install.semantic.manual-steps":
    "  1. 安装可选 embedder (向量编码器，装到 MCP server 解析模块的位置 — 全局安装即全局):\n" +
    "       npm i -g fastembed\n" +
    "  2. 预热模型缓存 (首跑会联网下载模型权重 ~数十-数百 MB, 不上传任何 KB 数据):\n" +
    "       export FABRIC_EMBED_CACHE_DIR=~/.cache/fabric-embed   # 严格离线者预先放好权重\n" +
    "  注: 切换 embed_model 后已有向量维度/语义变化, 下次 recall 会按新模型重新嵌入 (doc 向量按文本缓存, 自动失配重算)。\n" +
    "  关闭: 编辑 fabric.config.json 设 embed_enabled=false。",
  // C5: store onboarding 交互文案统一走 t()。
  "cli.install.store.local-store": "本地 store",
  "cli.install.store.bind-mounted.prompt": "把一个已挂载的知识 store 绑定到本项目？",
  "cli.install.store.setup.prompt": "为本项目设置知识 store？",
  "cli.install.store.setup.bind-label": "绑定已挂载: {alias}",
  "cli.install.store.setup.already-bound": "已绑定本项目: {aliases} ✓",
  // W2 dual-slot (TASK-002): 个人库槽 + 团队库槽 的状态 / 提示文案。团队库槽按
  // 「类别」命名(team 类),候选项显示 store 的真实 alias —— 文案 MUST NOT 暗示
  // 该库必须叫 'team'(team 是类别非别名,守 KT-MOD-0001 命名撞轴)。
  "cli.install.store.slot.personal.status": "个人库(本机全局): '{alias}' ✓",
  "cli.install.store.slot.personal.absent": "个人库(本机全局): 尚未建立",
  "cli.install.store.slot.personal.multi-none": "个人库(本机全局): 已挂 {count} 个,尚未选定 active",
  "cli.install.store.slot.personal.multi-prompt": "选择本机当前要用的 personal store(active):",
  "cli.install.store.slot.personal.multi-active-label": "'{alias}'(当前 active)",
  "cli.install.store.slot.personal.multi-switch-label": "切到 '{alias}'",
  "cli.install.store.slot.personal.multi-new-label": "新建本地 personal store",
  "cli.install.store.slot.personal.multi-new-hint": "全新空 personal store,并设为 active",
  "cli.install.store.slot.personal.new-alias": "新 personal store 的别名:",
  "cli.install.store.slot.personal.switched": "已将本机活动 personal store 切到 '{alias}'",
  "cli.install.store.slot.team.status": "团队库(team 类): '{alias}'{source} ✓",
  "cli.install.store.slot.team.empty": "团队库(team 类): 尚未绑定",
  "cli.install.store.slot.team.prompt": "为本项目选择团队知识库(team 类):",
  "cli.install.store.slot.team.bound-label": "保持当前: {alias}",
  "cli.install.store.slot.team.switch-label": "切到已挂载: {alias}",
  // flat-design store menu:「保持当前」与「跳过」语义合并 —— 已绑定时 SKIP 行显示
  // 为 keep-label(保持当前 · 不改动),未绑定时为「跳过 · 仅用 personal store」。
  "cli.install.store.slot.team.keep-label": "保持当前: {alias} · 不改动",
  "cli.install.store.slot.team.keep-hint": "{source}继续用这个团队库,本次不改动绑定",
  "cli.install.store.skip-label": "跳过",
  "cli.install.store.bind-mounted.skip-hint": "暂不绑定已挂载的 store",
  "cli.install.store.project-coordinate": "在 store '{store}' 中的项目坐标 (project coordinate):",
  "cli.install.store.project-pick.prompt": "store '{store}' 已有其它项目,且与本仓库 git 名不匹配 —— 加入已有项目还是新建?",
  "cli.install.store.project-pick.join": "加入已有:{name} ({id})",
  "cli.install.store.project-pick.new": "➕ 新建项目 {id}",
  "cli.install.store.project-pick.new-name": "新项目 id (project coordinate):",
  "cli.install.store.bound-success": "已把 store '{alias}' 绑定到本项目并设为写入目标 (write target)。",
  "cli.install.store.created-success": "已创建 store '{alias}'、绑定到本项目并设为写入目标 (write target)。",
  "cli.install.store.onboard.prompt": "为本项目设置一个团队 / 共享知识 store？",
  "cli.install.store.onboard.skip-hint": "仅用 personal store (默认)",
  "cli.install.store.onboard.join-label": "加入已有",
  "cli.install.store.onboard.join-hint": "从 git remote 克隆 + 绑定一个共享 store",
  "cli.install.store.onboard.create-label": "新建",
  "cli.install.store.onboard.create-hint": "新建一个本地 store (可选 remote 托管)",
  "cli.install.store.onboard.join-url": "共享 store 的 git remote (url):",
  "cli.install.store.onboard.alias": "新 store 的本地别名 (alias):",
  "cli.install.store.onboard.remote": "用于托管它的 git remote (可选 — 留空跳过):",
  "cli.install.store.unbound-note": "注意: 以下 store 已挂载但未绑定到本项目: {aliases}。",
  "cli.install.store.unbound-hint": "  运行 'fabric store bind {first}' 绑定其一。",
  // C4: personal store clone-or-new。
  // TASK-004: 首装时为额外的一次性提问(语言 / 个人库 onboarding)加的语境前缀,
  // 让用户知道这些问题只在首次设置时出现。
  "cli.install.store.firstRunContext": "首次设置中 —— 以下为仅首装出现的一次性选择:",
  "cli.install.store.personal.prompt": "本机还没有 personal store (个人知识库)。新建一个，还是从 remote 克隆你已有的？",
  "cli.install.store.personal.new-label": "新建本地 (默认)",
  "cli.install.store.personal.new-hint": "全新空 personal store",
  "cli.install.store.personal.clone-label": "克隆已有",
  "cli.install.store.personal.clone-hint": "从 git remote 克隆你备份的 personal store",
  "cli.install.store.personal.clone-url": "你的 personal store 的 git remote (url):",
  "cli.install.store.personal.cloned-success": "已从 remote 克隆 personal store ({uuid})。",
  "cli.install.store.personal.clone-failed": "克隆 personal store 失败（{reason}），改为新建本地空 store。",
  "cli.install.capabilities.none": "没有检测到可用于 bootstrap 或 MCP 后续接力的受支持客户端。",
  "cli.install.capabilities.header.client": "客户端",
  "cli.install.capabilities.header.bootstrap": "Bootstrap",
  "cli.install.capabilities.header.mcp": "MCP",
  "cli.install.capabilities.header.hook": "Hook",
  "cli.install.capabilities.header.skill": "Skill",
  "cli.install.capabilities.header.follow-up": "后续动作",
  "cli.install.capabilities.status.ready": "已就绪",
  "cli.install.capabilities.status.installed": "已安装",
  "cli.install.capabilities.status.supported": "已支持",
  "cli.install.capabilities.status.manual": "手动处理",
  "cli.install.capabilities.status.skipped": "已跳过",
  "cli.install.capabilities.status.failed": "失败",
  "cli.install.capabilities.status.na": "不适用",
  "cli.install.capabilities.follow-up.ready": "可在客户端继续",
  "cli.install.capabilities.follow-up.install": "安装客户端资产",
  "cli.install.capabilities.follow-up.manual": "需要手动后续处理",
  "cli.install.next-step.message": "运行 fabric install --reapply --yes 以刷新 Fabric 管理的 hooks 与客户端配置。",
  "cli.install.reason-message.installable-body": ".fabric/forensic.json 已就绪；部分已检测到的客户端已支持 Fabric 后续接力，但仍需安装客户端资产。",
  "cli.install.reason-message.manual-body": ".fabric/forensic.json 已就绪；部分已检测到的客户端尚未安装 Fabric skill，需要手动完成后续安装。",
  "cli.install.codex-hooks.created": "{label} {path}，并写入 Codex hooks 配置（需启用 features.codex_hooks = true）。",
  "cli.install.codex-hooks.updated": "{label} {path}，并写入 Codex hooks 配置（需启用 features.codex_hooks = true）。",
  "cli.install.codex-hooks.skipped": "{label} {path}：Codex hooks 配置已存在。",
  "cli.install.claude-settings.created": "{label} {path}，并写入 Claude Stop hook。",
  "cli.install.claude-settings.updated": "{label} {path}，并写入 Claude Stop hook。",
  "cli.install.claude-settings.skipped": "{label} {path}：Claude Stop hook 已存在。",
  "cli.install.claude-settings.skipped-invalid": "{label} {path}：无法合并 Claude Stop hook。",
  "cli.install.claude-settings.invalid-object": "{label} {path}：预期为 JSON 对象。",
  "cli.install.claude-settings.invalid-json": "{label} {path}：JSON 无效（{reason}）。",
  "cli.install.claude-settings.invalid-hooks": "{label} {path}：\"hooks\" 必须是 JSON 对象。",
  "cli.install.claude-settings.invalid-stop-array": "{label} {path}：\"hooks.Stop\" 必须是数组。",
  "cli.install.errors.abort-existing": "中止：{path} 已存在。fabric install 是非破坏性的。",
  "cli.install.diff.canonical": "工作区已是规范状态（已校验 {count} 个文件）。",
  "cli.install.diff.applying-missing": "正在补齐 {count} 个缺失项：{files}",
  "cli.install.diff.drift-abort":
    "检测到 {path} 已被修改。运行 `fabric doctor` 进行检查，或 `fabric uninstall && fabric install` 进行重置。",
  "cli.install.diff.drift-abort.action-hint":
    "先运行 `fabric doctor` 检查漂移；如果需要重置托管文件，运行 `fabric uninstall && fabric install`。",
  "cli.install.diff.state.missing": "缺失",
  "cli.install.diff.state.present-canonical": "规范",
  "cli.install.diff.state.drifted": "漂移",
  "cli.install.diff.state.user-modified": "用户修改",

  "cli.uninstall.description":
    "从目标项目中卸载 Fabric（~/.fabric/stores/ 下的全局 store 永不删除）",
  "cli.uninstall.args.target.description":
    "目标项目路径。默认依次使用 --target、EXTERNAL_FIXTURE_PATH、当前目录。",
  "cli.uninstall.args.debug.description": "将目标解析细节输出到 stderr。",
  "cli.uninstall.args.yes.description": "接受当前卸载计划并跳过 TTY 向导直接执行。",
  "cli.uninstall.args.verbose.description": "显示每个阶段的逐路径明细计数，而非精简结果行。",
  "cli.uninstall.args.unbind-store.description":
    "同时解绑本项目对团队 store 的绑定（清空 .fabric/fabric-config.json 中的绑定）。~/.fabric/stores/ 下的全局 store 永不删除。",
  "cli.uninstall.args.dry-run.description": "仅输出卸载计划，不删除文件也不执行后续阶段。",
  "cli.uninstall.plan.title": "Fabric 卸载计划",
  // C3: 镜像 install 的阶段提示 (install 用 "Fabric install 将按 N 个阶段执行")。
  "cli.uninstall.plan.phase-banner": "Fabric uninstall 将按 {total} 个阶段执行",
  "cli.uninstall.plan.target": "目标：{target}",
  // flat-design-system Wave5 (TASK-004 G3): 计划预览用人话动作句，按启用的阶段逐条列，
  // 不再输出 `key=是/否` 黑话行。
  "cli.uninstall.plan.will-remove": "将移除：",
  "cli.uninstall.plan.will-keep": "将保留：",
  "cli.uninstall.plan.action.bootstrap": "客户端技能与 hook 脚本",
  "cli.uninstall.plan.action.mcp": "MCP 服务注册",
  "cli.uninstall.plan.action.scaffold": "项目脚手架文件",
  "cli.uninstall.plan.action.store": "团队 store 绑定（本项目）",
  "cli.uninstall.plan.detected": "检测到的客户端：{clients}",
  "cli.uninstall.plan.preserves": "保留项：",
  "cli.uninstall.plan.preserves.stores": "全局知识 stores，项目卸载永不删除",
  "cli.uninstall.plan.preview-title": "Fabric 卸载 dry run",
  "cli.uninstall.plan.scaffold-entries.title": "Scaffold 待清理项：",
  // W4: 共享 OutputRenderer pipeline —— section bar 标题 + 各阶段标签，install
  // pipeline 的对称逆。
  "cli.uninstall.pipeline.title": "Fabric 卸载",
  "cli.uninstall.pipeline.label.bootstrap": "Skills 与 hooks",
  "cli.uninstall.pipeline.label.mcp": "MCP server",
  "cli.uninstall.pipeline.label.store": "解绑 store",
  "cli.uninstall.pipeline.label.scaffold": "清理脚手架",
  "cli.uninstall.pipeline.label.validate": "校验已清理",
  "cli.uninstall.stages.completed": "已完成",
  "cli.uninstall.stages.completed-with-errors": "完成但有错误",
  "cli.uninstall.stages.failed": "失败",
  "cli.uninstall.stages.failed-hint": "查看上方错误详情。加 --debug 获取更多信息。",
  "cli.uninstall.stages.uptodate": "无可移除（{count} 项已不存在）",
  "cli.uninstall.stages.summary": "removed={removed} skipped={skipped} errors={errors}",
  "cli.uninstall.stages.removed-count": "已移除 {count} 项",
  // flat-design-system Wave5 (TASK-006 G3): 总结卡明细行的人话结果词，与 install 的
  // `已安装 {count} 项` / `已最新` 对称。
  "cli.uninstall.stage.cleaned-count": "已清理 {count} 项",
  "cli.uninstall.summary.title": "卸载摘要",
  "cli.uninstall.summary.body": "removed={removed} skipped={skipped} errors={errors}",
  "cli.uninstall.healthcheck.title": "✓ Fabric 已不存在 · 无可移除",
  "cli.uninstall.wizard.intro": "卸载 Fabric",
  "cli.uninstall.wizard.select.prompt":
    "要从 {target} 卸载哪些部分？(空格勾选 / 回车确认；~/.fabric/stores/ 下的全局知识 store 永不删除)",
  "cli.uninstall.wizard.select.scaffold.label": "scaffold 产物",
  "cli.uninstall.wizard.select.scaffold.hint": ".fabric/ 下的脚手架文件",
  "cli.uninstall.wizard.select.bootstrap.label": "Skills 与 hooks",
  "cli.uninstall.wizard.select.bootstrap.hint": "各客户端的 skills 与 hook 脚本 + 配置",
  "cli.uninstall.wizard.select.mcp.label": "MCP 客户端注册",
  "cli.uninstall.wizard.select.mcp.hint": "从各客户端反注册 fabric MCP server",
  "cli.uninstall.wizard.select.store.label": "解绑团队 store（本项目）",
  "cli.uninstall.wizard.select.store.hint": "清空本项目的 store 绑定；全局 store 永不删除",
  "cli.uninstall.wizard.execute.confirm": "现在执行该卸载计划？[Y/n]",
  "cli.uninstall.wizard.outro": "卸载计划已确认，开始执行 Fabric uninstall...",
  "cli.uninstall.wizard.cancelled": "Fabric 卸载已在执行前取消。",
  "cli.uninstall.confirm.proceed": "确认从 {target} 卸载 Fabric？[y/N]",
  "cli.uninstall.errors.target-not-directory": "目标必须是已存在的目录：{path}",



  // v2.0.0-rc.37 Wave A2 Part 2: cli.serve.* + FABRIC_AUTH_TOKEN keys removed
  // alongside `fabric serve` quarantine to packages/server-http-experimental/
  // per [[fabric-serve-quarantine-not-delete]]. Restore from git history when
  // the web UI surface is re-enabled.

  // v2.0.0-rc.29 TASK-008 (BUG-L2): onboard-coverage 国际化键。
  "cli.first-hit.description": "验收 install→first-hit 就绪（bind + 非空知识面）",
  "cli.first-hit.args.json.description": "机器可读 JSON 报告",
  "cli.first-hit.args.target.description": "项目根（默认 cwd）",
  "cli.first-hit.args.seed.description": "若 store 为空则写入最小 starter 知识条目",
  "cli.first-hit.args.paths.description": "逗号分隔的探测路径",
  "cli.onboard-coverage.description":
    "汇总当前工作区的 S5 onboard-slot 覆盖度。fabric-archive Skill 首跑阶段用它判断哪些项目语调槽位尚未被认领。",
  "cli.onboard-coverage.args.json.description":
    "输出机器可读的 JSON 到 stdout（替代人类可读的表格）。",
  "cli.onboard-coverage.args.target.description":
    "覆盖项目根目录（默认为当前工作目录）。",


  "dashboard.app.nav.aria-label": "仪表盘视图",

  "dashboard.app.nav.readiness.label": "准备情况",
  "dashboard.app.nav.readiness.label-bilingual": "准备情况 Readiness",
  "dashboard.app.nav.readiness.subtitle": "项目状态",
  "dashboard.app.nav.rules-explain.label": "规则解析",
  "dashboard.app.nav.rules-explain.label-bilingual": "规则解析 Rules Explain",
  "dashboard.app.nav.rules-explain.subtitle": "拓扑与上下文",
  "dashboard.app.nav.timeline.label": "时间线",
  "dashboard.app.nav.timeline.label-bilingual": "时间线 Timeline",
  "dashboard.app.nav.timeline.subtitle": "审计与历史",
  "dashboard.app.nav.health.label": "系统健康",
  "dashboard.app.nav.health.label-bilingual": "系统健康 Health",
  "dashboard.app.nav.health.subtitle": "诊断台",
  "dashboard.app.nav.section.insights": "洞察",
  "dashboard.app.nav.drift-check": "漂移检查",
  "dashboard.app.nav.modules.read-only": "只读仪表盘",
  "dashboard.app.header.connected": "已连接",
  "dashboard.app.header.connecting": "连接中",
  "dashboard.app.live-region.received": "已收到 {type}",
  "dashboard.app.breadcrumb.readiness": "readiness",
  "dashboard.app.breadcrumb.rules-explain": "rules-explain",
  "dashboard.app.breadcrumb.timeline": "timeline",
  "dashboard.app.breadcrumb.health": "health",

  "dashboard.rule-topology.title": "规则命中",
  "dashboard.rule-topology.subtitle": "查看当前路径会命中哪些规则，以及为什么会命中",
  "dashboard.rule-topology.path.placeholder": "用于规则上下文的样本路径",
  "dashboard.rule-topology.path.aria-label": "规则上下文样本路径",
  "dashboard.rule-topology.status.sample": "当前路径 {path}",
  "dashboard.rule-topology.status.hits": "{count} 条命中",
  "dashboard.rule-topology.status.revision": "版本 {revision}",
  "dashboard.rule-topology.heatmap.title": "覆盖热力图",
  "dashboard.rule-topology.heatmap.subtitle": "基于 scope_glob 模式推导的目录覆盖情况",
  "dashboard.rule-topology.heatmap.aria-label": "目录覆盖热力图",
  "dashboard.rule-topology.heatmap.count": "{count} 个目录",
  "dashboard.rule-topology.heatmap.rules": "{count} 条规则",
  "dashboard.rule-topology.heatmap.uncovered": "没有匹配作用域",
  "dashboard.rule-topology.heatmap.empty": "当前没有可显示的规则目录。",
  "dashboard.rule-topology.heatmap.density.full": "已覆盖",
  "dashboard.rule-topology.heatmap.density.partial": "部分覆盖",
  "dashboard.rule-topology.heatmap.density.none": "未覆盖",
  "dashboard.rule-topology.hit-reason.title": "命中原因",
  "dashboard.rule-topology.hit-reason.subtitle": "显示当前样本路径为何命中这些规则",
  "dashboard.rule-topology.hit-reason.aria-label": "规则命中原因",
  "dashboard.rule-topology.hit-reason.count": "{count} 条原因",
  "dashboard.rule-topology.hit-reason.empty": "当前样本路径没有加载到规则。",
  "dashboard.rule-topology.hit-reason.global": "全局",
  "dashboard.rule-topology.hit-reason.tier.always": "常驻",
  "dashboard.rule-topology.hit-reason.tier.path": "Glob",
  "dashboard.rule-topology.hit-reason.tier.description": "描述",

  "dashboard.module-placeholder.coming-soon": "功能预留",
  "dashboard.module-placeholder.read-only": "为后续只读仪表盘能力预留。",
  "dashboard.module-placeholder.forensic.title": "认知扫描",
  "dashboard.module-placeholder.forensic.subtitle": "后续补充",
  "dashboard.module-placeholder.semantic.title": "语义时间线",
  "dashboard.module-placeholder.semantic.subtitle": "后续补充",
  "dashboard.module-placeholder.ledger.title": "历史记录",
  "dashboard.module-placeholder.ledger.subtitle": "后续补充",

  "dashboard.rules-tree.title": "规则树",
  "dashboard.rules-tree.subtitle": "查看 .fabric/agents.meta.json 中的规则结构、层级和同步状态",
  "dashboard.rules-tree.filter.placeholder": "按文件、作用域、优先级、哈希过滤...",
  "dashboard.rules-tree.filter.aria-label": "过滤规则树",
  "dashboard.rules-tree.status.loading": "规则加载中",
  "dashboard.rules-tree.status.nodes": "{count} 个节点 · 版本 {revision}",
  "dashboard.rules-tree.status.locks": "{count} 个受保护区域",
  "dashboard.rules-tree.empty": "没有匹配的规则。",
  "dashboard.rules-tree.tree.aria-label": "Fabric 规则树",
  "dashboard.rules-tree.detail.title": "节点详情",
  "dashboard.rules-tree.detail.empty": "选择一个规则节点以查看作用域、依赖、优先级和哈希。",
  "dashboard.rules-tree.detail.file": "文件",
  "dashboard.rules-tree.detail.scope": "作用域",
  "dashboard.rules-tree.detail.priority": "优先级",
  "dashboard.rules-tree.detail.hash": "哈希",
  "dashboard.rules-tree.detail.no-deps": "无依赖",

  "dashboard.human-lock.title": "人工保护",
  "dashboard.human-lock.subtitle": "查看需要人工确认的受保护区域",
  "dashboard.human-lock.filters.aria-label": "人工保护过滤器",
  "dashboard.human-lock.filters.all": "全部",
  "dashboard.human-lock.filters.drift": "漂移",
  "dashboard.human-lock.filters.approved": "已批准",
  "dashboard.human-lock.summary": "{drift} 处漂移 · {approved} 项已确认",
  "dashboard.human-lock.empty": "当前过滤条件下没有受保护记录。",

  "dashboard.intent-timeline.title": "意图时间线",
  "dashboard.intent-timeline.subtitle": "查看 AI 与人工留下的变更记录，按时间倒序排列",
  "dashboard.intent-timeline.filter.label": "来源",
  "dashboard.intent-timeline.filter.all": "全部",
  "dashboard.intent-timeline.summary": "AI {aiCount} · Human {humanCount}",
  "dashboard.intent-timeline.columns.ai.title": "AI",
  "dashboard.intent-timeline.columns.ai.entries": "{count} 条记录",
  "dashboard.intent-timeline.columns.human.title": "人工",
  "dashboard.intent-timeline.columns.human.entries": "{count} 条记录",
  "dashboard.intent-timeline.empty": "没有找到日志记录。",
  "dashboard.intent-timeline.annotate.missing-id": "缺少 id，无法为这条日志添加注释。",

  "dashboard.history-replay.title": "历史回放",
  "dashboard.history-replay.subtitle": "按历史记录回看当时的规则树状态",
  "dashboard.history-replay.toolbar.scrub": "拖动",
  "dashboard.history-replay.toolbar.latest": "最新",
  "dashboard.history-replay.selected.none": "尚未选择历史记录",
  "dashboard.history-replay.status.replay-points": "{count} 个回放点",
  "dashboard.history-replay.status.entries-applied": "已应用 {count} 条记录",
  "dashboard.history-replay.empty.entries": "没有可用于回放的日志记录。",
  "dashboard.history-replay.state.title": "查看 {label} 时刻的状态",
  "dashboard.history-replay.state.meta": "记录 {ledgerId} · 提交 {commit} · {mode}",
  "dashboard.history-replay.status.loading": "快照加载中",
  "dashboard.history-replay.status.nodes": "{count} 个节点",
  "dashboard.history-replay.status.unknown-revision": "未知版本",
  "dashboard.history-replay.tree.aria-label": "历史 Fabric 规则树",
  "dashboard.history-replay.empty.loading": "正在加载历史快照...",
  "dashboard.history-replay.empty.select": "请选择一条时间线记录以回放其状态。",
  "dashboard.history-replay.meta.not-available": "不可用",
  "dashboard.history-replay.meta.pending": "等待中",
  "dashboard.history-replay.meta.na": "无",

  "dashboard.doctor.title": "诊断控制台",
  "dashboard.doctor.subtitle": "查看框架、入口点、版本漂移和受保护路径的状态",
  "dashboard.doctor.toolbar.overall": "整体状态",
  "dashboard.doctor.toolbar.no-summary": "暂无摘要",
  "dashboard.doctor.toolbar.entry-points-summary": "{framework} · {count} 个入口点",
  "dashboard.doctor.toolbar.entry-point-summary": "{framework} · {count} 个入口点",
  "dashboard.doctor.empty.loading": "正在加载 doctor 报告...",
  "dashboard.doctor.summary.framework": "框架",
  "dashboard.doctor.summary.protected-paths": "受保护路径",
  "dashboard.doctor.summary.intent-ledger": "意图日志",
  "dashboard.doctor.summary.no-meta-revision": "暂无元数据版本",
  "dashboard.doctor.summary.tracked-paths.none": "没有跟踪路径",
  "dashboard.doctor.summary.tracked-paths.some": "已跟踪 {count} 项",
  "dashboard.doctor.summary.hashes-intact": "所有已批准哈希均完好",
  "dashboard.doctor.summary.drifted": "{count} 项发生漂移",
  "dashboard.doctor.summary.no-ledger-entries": "暂无日志记录",
  "dashboard.doctor.card.entry-points": "入口点",
  "dashboard.doctor.card.checks": "检查项",
  "dashboard.doctor.empty.entry-points": "当前未检测到入口点。",
  "dashboard.doctor.framework.unknown": "未知",
  "dashboard.doctor.age.none": "暂无记录",
  "dashboard.doctor.age.seconds": "{count} 秒前",
  "dashboard.doctor.age.minutes": "{count} 分钟前",
  "dashboard.doctor.age.hours": "{count} 小时前",
  "dashboard.doctor.age.days": "{count} 天前",
  "dashboard.doctor.age.weeks": "{count} 周前",

  "dashboard.shared.refresh": "刷新",
  "dashboard.shared.loading": "加载中",
  "dashboard.shared.status.ok": "正常",
  "dashboard.shared.status.warn": "警告",
  "dashboard.shared.status.error": "错误",
  "dashboard.shared.status.confirmed": "已确认",
  "dashboard.shared.status.hash-drift": "哈希漂移",
  "dashboard.shared.status.stale": "过期",
  "dashboard.shared.status.orphan": "孤立",
  "dashboard.shared.status.attention": "注意",

  "dashboard.source.ai": "AI",
  "dashboard.source.human": "人工",

  "dashboard.timeline-entry.aria-label": "{source} 意图 {intent}",
  "dashboard.timeline-entry.working-tree": "工作区",
  "dashboard.timeline-entry.parent": "父提交 {parent}",
  "dashboard.timeline-entry.paths": "路径",
  "dashboard.timeline-entry.annotate": "添加注释",
  "dashboard.timeline-entry.annotation-label": "人工注释",
  "dashboard.timeline-entry.annotation-placeholder": "说明审核结论或批准背景...",
  "dashboard.timeline-entry.annotation-save": "保存注释",

  "dashboard.tree-node.locked": "已锁定",
  "dashboard.tree-node.stale.hash-mismatch": "哈希不匹配",
  "dashboard.tree-node.stale.orphan": "孤立",

  "dashboard.lock-card.aria-label": "{file} {lineRange} {status}",
  "dashboard.lock-card.status.drift": "哈希漂移",
  "dashboard.lock-card.status.confirmed": "已确认",
  "dashboard.lock-card.hash.locked": "锁定哈希",
  "dashboard.lock-card.hash.current": "当前哈希",
  "dashboard.lock-card.hash.diff": "差异",
  "dashboard.lock-card.preview.drift": "漂移",
  "dashboard.lock-card.preview.sync": "同步",
  "dashboard.lock-card.preview.drift-detail": "哈希与受保护区域不一致。",
  "dashboard.lock-card.preview.sync-detail": "受保护区域当前保持同步。",
  "dashboard.lock-card.footer.region": "受保护区域 · {count} 行",
  "dashboard.lock-card.button.approve": "批准新哈希",
  "dashboard.lock-card.button.confirmed": "已确认",
  "dashboard.lock-card.diff.hash-mismatch": "哈希不一致",
  "dashboard.lock-card.diff.no-changes": "无变更",
  "dashboard.lock-card.diff.with-bytes": "+{added} / -{removed} · {bytes} 字节",
  "dashboard.lock-card.diff.without-bytes": "+{added} / -{removed}",

  "dashboard.approve-button.retry": "重试",

  "dashboard.readiness.filter.analysis": "项目分析",
  "dashboard.readiness.loading": "正在加载扫描数据...",
  "dashboard.readiness.summary.framework": "框架",
  "dashboard.readiness.summary.files": "文件",
  "dashboard.readiness.summary.status": "Fabric 状态",
  "dashboard.readiness.card.evidence": "准备情况凭证",
  "dashboard.readiness.card.recommendations": "建议与后续步骤",
  "dashboard.readiness.readme.description": "项目文档的质量",
  "dashboard.readiness.contributing.description": "AI与人类协作的贡献指南",
  "dashboard.readiness.fully-ready": "项目已完全准备就绪。",
  "dashboard.readiness.init-prompt": "运行此命令进行初始化：",

  "dashboard.rules-explain.analyze": "分析路径",
  "dashboard.rules-explain.detail.topology-type": "拓扑类型",

  "dashboard.timeline.history-replay.title": "历史回放",
  "dashboard.timeline.close": "关闭",

  "dashboard.health.ledger-path.label": "事件账本路径",
  "dashboard.health.ledger-path.detail": "只能追加写入的时间线数据源",
  "dashboard.health.boundary.title": "控制平面边界",
  "dashboard.health.boundary.description": "Web 控制台作为纯查看器 (Viewer) 运行。所有规则、元数据和修复操作都必须通过 CLI 进行管理。",
  "dashboard.health.boundary.cli-action": "需要执行 CLI 操作：",
  "dashboard.health.boundary.cli-prompt": "检测到 {count} 个可修复的问题。请在终端中运行以下命令以自动修复元数据。",
  "dashboard.health.runtime.connected": "MCP 运行时已连接",
  "dashboard.health.runtime.disconnected": "MCP 运行时已断开",

  // W3-05 (ISS-033): 项目作用域命令输出 (whoami / store / scope-explain /
  // sync / metrics) —— 原硬编码英文, 现按项目 fabric_language 渲染。
  "cli.cmd.no-global-config": "未找到全局 Fabric 配置 —— 请先运行 `fabric install --global <url>`",
  "cli.whoami.uid": "uid: {uid}",
  "cli.whoami.stores-none": "stores: (未挂载任何 store)",
  "cli.whoami.stores-label": "stores:",
  "cli.shared.local-only": "(仅本地)",
  // `fabric info`(平铺风)—— 身份 / 项目状态 / 召回引擎 标题与字段标签。
  "cli.info.field.uid": "uid",
  "cli.info.identity.title": "Fabric 身份",
  "cli.info.status.title": "项目状态",
  "cli.info.status.group.machine": "本机",
  "cli.info.status.group.project": "当前项目",
  "cli.info.status.field.project": "项目",
  "cli.info.status.field.mounted": "已挂载库",
  "cli.info.status.field.bound": "绑定库",
  "cli.info.status.value.unset": "(未设置)",
  "cli.info.status.value.not-project": "(非 Fabric 项目)",
  "cli.info.status.value.no-global": "(无全局配置)",
  "cli.info.recall.title": "召回引擎",
  "cli.info.recall.summary.on": "语义搜索已开 —— 详情 fabric info --recall",
  "cli.info.recall.summary.off": "关键词模式 · 语义搜索未开 —— 详情 fabric info --recall",
  "cli.info.recall.mode.additive": "additive(关键词模式)",
  "cli.info.recall.mode.rrf": "rrf(关键词+语义)",
  "cli.info.recall.reason.forced-additive": "配置固定为关键词模式(additive)",
  "cli.info.recall.reason.auto-additive": "向量通道未就绪,自动回退到关键词模式",
  "cli.info.recall.reason.auto-rrf": "向量通道就绪,使用关键词+语义融合(rrf)",
  "cli.info.recall.reason.rrf-ready": "配置固定为 rrf,向量通道就绪",
  "cli.info.recall.reason.rrf-warn": "配置固定为 rrf,但向量通道未就绪 —— 单通道 rrf 反而比关键词模式差",
  "cli.info.recall.install-hint": "装它开启语义搜索:npm i -g fastembed",
  "cli.info.recall.field.fusion-config": "融合策略(配置)",
  "cli.info.recall.field.fusion-effective": "融合策略(实际)",
  "cli.info.recall.field.embed-enabled": "embed 开启",
  "cli.info.recall.field.embed-model": "embed 模型",
  "cli.info.recall.field.fastembed": "fastembed 包",
  "cli.info.recall.field.cache-dir": "模型缓存",
  "cli.info.recall.field.model-cached": "模型已缓存",
  "cli.info.recall.field.vector": "向量通道",
  "cli.info.recall.fastembed.yes": "可解析",
  "cli.info.recall.fastembed.no": "未安装(可选依赖)",
  "cli.info.recall.cached.no": "未缓存 —— 首次召回时下载(或运行 `fabric info --recall --warm`)",
  "cli.info.recall.vector.ready": "就绪",
  "cli.info.recall.vector.not-ready": "未就绪 —— 召回回退到关键词模式(BM25 / additive)",
  "cli.info.recall.warm.ok": "embedder 已预热:模型 '{model}' 已加载(向量维度 {dim}),缓存于 {dir}",
  "cli.info.recall.warm.fail":
    "embedder 不可用 —— 可选的 'fastembed' 包无法解析,或模型加载失败。\n  召回回退到关键词模式(BM25 / additive)。请在 server 能解析模块的位置安装 fastembed 后重试。",
  "cli.store.list.description": "列出挂载的 store",
  // 追加在 `fabric store --help` 末尾的说明 —— 交代进阶(meta.hidden)操作去哪了,
  // 否则只剩 list 一行会让用户以为 store 没别的能力。
  "cli.store.help.folded-note":
    "进阶操作(create / bind / switch-write / migrate 等)已折叠 —— 由 fabric install 与 fabric-store skill 驱动;需要时直接 `fabric store <命令> --help` 查看。",
  "cli.store.list.title": "已挂载知识库",
  "cli.store.project.list.title": "store '{store}' 中的项目",
  "cli.store.project.list.empty": "(无已注册项目)",
  "cli.store.project.created": "已在 store '{store}' 注册项目 '{id}'",
  "cli.store.migrate.title": "知识坐标迁移",
  "cli.store.backfill.noop": "scope 回填:无需改动({count} 条已一致)",
  "cli.store.backfill.summary": "scope 回填:{changed} 条已更新,{unchanged} 条未变",
  "cli.store.backfill.scope-note":
    "{count} 条默认设为 semantic_scope: team。用 `fabric store migrate scope <store> --to project:<id> --id <id>` 把项目专属的降级。",
  "cli.store.rescope.noop": "重定 scope:无需改动({count} 条已是 '{scope}')",
  "cli.store.rescope.summary": "重定 scope → {scope}:{changed} 条已更新,{unchanged} 条未变",
  "cli.store.rescope.refused": "{count} 条被拒绝",
  "cli.store.reroot.noop": "reroot:无需迁移({skipped} 条保持平铺)",
  "cli.store.reroot.summary": "reroot:{moved} 条项目条目已迁入 knowledge/projects/<id>/",
  "cli.store.reroot.provenance-gap":
    "{count} 条经 fs rename 迁移(未跟踪 / 非 git)—— 这些条目的 git blame 历史未保留",
  "cli.store.none-mounted": "(未挂载任何 store)",
  "cli.store.mounted": "已挂载 '{alias}' (共 {count} 个 store)",
  "cli.store.created": "已创建 store '{alias}' ({uuid}) 于 {dir}",
  "cli.store.created-local-hint":
    "(仅本地 —— 稍后用 `git -C <storeDir> remote add origin <url>` 添加 remote)",
  "cli.store.no-alias": "没有别名为 '{alias}' 的 store",
  "cli.store.detached": "已分离 '{alias}' —— 磁盘上的 store 目录保留 (分离 ≠ 删除)",
  "cli.store.bound": "已绑定必需 store '{id}' (共 {count} 个必需)",
  "cli.store.switch-write": "已将本项目的活动写入 store 设为 '{alias}'",
  "cli.store.switch-personal": "已将本机活动 personal store 设为 '{alias}'",
  "cli.store.routed": "写入路由:scope '{scope}' → store '{alias}'",
  "cli.sync.deferred": "{count} 个 store 离线 —— push 已延后; 联网后重新运行 `fabric sync`",
  "cli.sync.paused":
    "sync 因冲突暂停 —— 解决后运行 `fabric sync --continue` (或 `--abort`)",
  // flat-design (spec §0.4):`fabric sync` 命令级标题 + 每个 store 单行 + 聚合摘要。
  // state 文案在 store 行与摘要计数格之间共用。
  "cli.sync.args.continue.description": "解决 rebase 冲突后继续同步",
  "cli.sync.args.abort.description": "中止发生冲突的 store 的 rebase",
  "cli.sync.title": "同步知识库",
  "cli.sync.summary.title": "同步摘要",
  "cli.sync.none": "没有可同步的远程 store",
  "cli.sync.all-synced": "全部 store 已同步",
  "cli.sync.state.synced": "已同步",
  "cli.sync.state.offline": "离线",
  "cli.sync.state.conflict": "冲突",
  "cli.sync.state.aborted": "已中止",
  "cli.sync.state.pending": "待处理",
  "cli.metrics.invalid-since": '--since: 无效的时长 "{raw}" (示例: 24h、7d、30m)',
  "cli.metrics.window": "Fabric 指标 —— 时间窗: {window}",
  "cli.metrics.window-all-time": "全部时间",
  "cli.metrics.rows-range": "  行数: {count} ({start} → {end})",
  "cli.metrics.rows": "  行数: {count}",
  "cli.metrics.no-activity": "  (时间窗内无计数活动 —— server 可能空闲或刚启动)",
  "cli.metrics.col.counter": "计数器",
  "cli.metrics.col.total": "总计",
  "cli.metrics.col.entry": "条目",
  "cli.metrics.section.perEntry": "按条目消费排行 (knowledge_consumed:<id>)",

  // W3-09 (ISS-035): forensic 项目扫描进度 (stderr, 仅 TTY)。
  "cli.install.scanning": "正在扫描项目的客户端/框架特征…",
  "cli.install.scan-complete": "  项目扫描完成",

  // W4-11 (ISS-021): 统一项目扫描推荐(cli forensic + http scan 共用此 i18n key 集)。
  "scan.rec.install":
    "运行 `fabric install`，然后绑定并选择 mounted knowledge store 来承载 decisions/pitfalls/guidelines/models/processes。",
  "scan.rec.readme": "README 信息不足,建议在初始化访谈中补齐项目目标、运行方式和禁改区域。",
  "scan.rec.contributing": "补充 CONTRIBUTING.md,或在 mounted store 的 knowledge/processes/ 下记录贡献流程。",
  "scan.rec.cocos.lifecycle": "建议向用户确认 Cocos Creator Component 生命周期(onLoad/onEnable/start)顺序。",
  "scan.rec.cocos.human-protect": "建议询问 assets/prefabs 和 assets/scenes 是否属于 @HUMAN 保护区域。",
  "scan.rec.cocos.meta-lock": "检测到 .meta 文件,建议在 @HUMAN 锁定 .meta 不被 AI 改动。",
  "scan.rec.next": "建议确认 app/pages 路由边界和服务端组件约束。",
  "scan.rec.vite": "建议确认 src/main 入口、组件目录和构建脚本的维护边界。",
  "scan.rec.unknown": "未检测到明确框架,建议先让用户确认技术栈和主要入口。",
  "scan.rec.generic": "建议围绕 {kind} 的主要入口和生成目录确认 AGENTS.md 分层边界。",
};
