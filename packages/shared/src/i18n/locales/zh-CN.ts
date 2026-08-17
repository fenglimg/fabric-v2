import type { Messages } from "../types.js";

export const zhCNMessages: Messages = {
  "cli.signpost.retired": "命令 `{retired}` 已移除。请改用 `{successor}`。",
  "cli.doctor.args.probe.description":
    "输出机器可读 JSON 就绪快照(first-hit + store/hooks),不跑 --fix CI 优先用 --probe 做轻量就绪快照；完整 cite-coverage 扫描按需运行。",
  "cli.main.description":
    "Fabric CLI — 自动把本项目的决策 / 踩坑 / 规范喂给你的 AI 助手，让它不必每次会话重新学。首次使用?运行: fabric install",
  "cli.shared.skipped": "已跳过",
  "cli.shared.yes": "是",
  "cli.shared.no": "否",
  "cli.shared.none": "无",

  // flat-design-system Wave4 (TASK-004): clack 控件（select/multiselect/confirm/text）
  // 落定后打印的平铺无沟槽 ✓/x 回执行。控件保持原生（C-006），回执是独立的一行。
  "cli.prompt.receipt.selected": "已选",
  "cli.prompt.receipt.set": "已设置",
  "cli.prompt.receipt.cancelled": "已取消",
  "cli.shared.target-invalid": "目标必须是已存在的目录：{target}",
  "cli.shared.error": "错误",

  // 顶层命令摘要(每条一句精简单行 —— citty 在根 `fabric --help` 的 COMMANDS
  // 表与各命令自身 `--help` 头部都用它,必须保持单行;退掉自建分组帮助、改走
  // citty 渲染器后,原先的多行示例块已移除)
  "cli.store.description": "管理已挂载的知识 store(建库走 fabric install)",
  "cli.sync.description": "同步已挂载的知识 store(pull --rebase + push)",
  "cli.info.description": "显示 Fabric 身份、项目状态与召回健康",
  "cli.inspect.description": "显示 Fabric 在 SessionStart 注入了什么",
  // `fabric inspect` 参数说明 + --explain 溯源覆盖层 + 错误。
  "cli.inspect.arg.render":
    "显示哪个 sink:'human'(systemMessage)或 'ai'(additionalContext)。默认两个都显示。",
  "cli.inspect.arg.explain":
    "追加逐条来源溯源段(id · type · maturity · scope · 浮现原因)。",
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
  "cli.preview.arg.all":
    "显示所有已挂载 store 的知识(越过本项目 read-set;默认只显示本项目)。",
  "cli.preview.port-fallback": "端口 {requested} 被占用,已自动改用 {actual}。",
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
  "cli.audit.help.footer":
    "运行 `fabric audit <subcommand> --help` 查看各子命令参数。",

  // `fabric audit retired` — 平铺渲染文案。
  "cli.audit.retired.skipped":
    "已跳过 retired 引用扫描 —— 未发现 agent 消费面。",
  "cli.audit.retired.clean": "无 retired 引用 —— 已扫描 {count} 个 agent 面。",
  "cli.audit.retired.found": "在 {files} 个文件中发现 {hits} 处 retired 引用",
  "cli.audit.retired.removed": "（已移除）",

  // `fabric audit why-not-surfaced <id>` — 三轴诊断(store / scope / timing)。
  "cli.audit.why.not-found":
    "未在任何已挂载 store 中找到 '{id}'。请核对 id(可试 `fabric store list`)。",
  "cli.audit.why.store-unbound":
    "'{id}' 位于 store '{store}',但该 store 未绑定到本项目。",
  "cli.audit.why.store-unbound.hint": "绑定它:fabric store bind {store}",
  "cli.audit.why.project-mismatch":
    "'{id}' 的 scope 是 '{scope}',但本仓库绑定的是 'project:{project}'。",
  "cli.audit.why.project-mismatch.hint":
    "它只在绑定了 '{scope}' 的仓库中浮现(semantic_scope 轴)。",
  "cli.audit.why.narrow-timing":
    "'{id}' 是 relevance_scope=narrow —— 仅在你编辑匹配文件时由 PreToolUse 提示浮现,不在 SessionStart。",
  "cli.audit.why.narrow-timing.hint":
    "broad 条目是常驻脊柱;narrow 仅在编辑时浮现(timing 轴)。",
  "cli.audit.why.maturity-draft":
    "'{id}' 的 maturity={maturity} —— draft 的 guideline/model 属提案而非定论,不进 SessionStart 常驻规则层。",
  "cli.audit.why.maturity-draft.hint":
    "它仍可经 fab_recall 与编辑时提示取到;晋升(fab_review modify maturity: verified)后才进常驻层。",
  "cli.audit.why.should-surface":
    "'{id}' 应当正在浮现 —— store '{store}' 已绑定、scope 匹配、relevance_scope=broad。",
  "cli.audit.why.should-surface.hint":
    "若仍没浮现,可能是 SessionStart 快照过期:开个新会话或重跑 `fabric install`。",

  // `fabric info --help` —— flag 与 scope 子命令描述。
  "cli.info.args.global.description": "显示全局身份(whoami)而非项目状态",
  "cli.info.args.recall.description":
    "显示召回引擎详情(融合策略 + 向量嵌入状态)",
  "cli.info.args.warm.description":
    "配合 --recall:立即加载 embedder(首次会把模型下载到 ~/.fabric/cache/embed)",
  "cli.info.args.json.description": "输出机器可读的 JSON 而非文本",
  "cli.info.scope.description":
    "(进阶/skill)把一个 scope 坐标解析成 read-set + 写入目标的 JSON",
  "cli.info.scope.args.coord.description":
    "Scope 坐标(如 team、project:x、personal)",
  "cli.info.scope.args.json.description":
    "输出机器可读的 JSON(scope 始终输出 JSON)",

  "cli.config.description":
    "打开 Fabric 交互式配置面板（语言、知识层、审计模式、MCP 客户端配置等）",
  "cli.config.args.target.description": "目标项目目录（默认当前工作目录）。",
  "cli.config.errors.expected-object": "{path} 中应为对象。",

  // rc.16 TASK-006 (F1-panel): clack 驱动的 `fabric config` 交互式面板。
  // 由 packages/cli/src/commands/config.ts（菜单循环 + 字段编辑）以及
  // getPanelFields() 的 label_i18n_key 引用消费。
  "cli.config.intro": "Fabric 配置",
  // flat-design-system Wave5 (TASK-005): clack 编辑菜单前那块平铺键值面板的
  // B-横线标题。
  "cli.config.outro": "配置已保存。",
  "cli.config.outro-no-changes": "未做任何修改。",
  "cli.config.cancel": "已取消。",
  "cli.config.non-tty-notice":
    "fabric config 需要在交互式终端中运行。请在 TTY 中执行以编辑配置字段。",
  "cli.config.menu.field-select": "选择要编辑的字段：",
  "cli.config.menu.exit": "退出",
  "cli.config.value.current": "当前：{value}",
  "cli.config.value.default-marker": "（默认）",
  // config-single-home W6：值来自哪一层。同一个键可以在机器级、本项目级或团队
  // store 里被设置，标出来源才解释得清"为什么这个仓库读到的不一样"。
  "cli.config.source.project": "本项目",
  "cli.config.source.defaults": "全机器",
  "cli.config.source.store": "团队 store",
  "cli.config.source.global": "全局",
  "cli.config.source.default": "内置默认",
  // config-single-home W8：节奏档位——一次定好"多吵 + 多久催一次归档 + 待审积压
  // 到多少提醒"，这四件事本来就是一起动的。
  "cli.config.profile.label": "节奏档位",
  "cli.config.profile.prompt": "选一个节奏档位（会同时改 4 项设置）",
  "cli.config.profile.custom": "自定义",
  "cli.config.profile.quiet": "安静",
  "cli.config.profile.quiet.description": "几乎不打扰你，归档由你自己决定时机",
  "cli.config.profile.standard": "标准",
  "cli.config.profile.standard.description":
    "出厂节奏：每次会话一行状态，攒够一批再提醒归档",
  "cli.config.profile.coach": "教练",
  "cli.config.profile.coach.description":
    "催得勤，适合知识库刚起步、怕漏掉经验的阶段",
  "cli.config.prompt.select": "为 {key} 选择新值（当前：{current}）：",
  "cli.config.prompt.text": "为 {key} 输入新值（当前：{current}）：",
  "cli.config.panel.edited": "本次已改（{count} 项）：{keys}",
  "cli.config.write.failure": "写入 fabric-config.json 失败：{message}",
  "cli.config.slot.errors.missing":
    "缺少必填的 <slot> 参数。可用槽位：{slots}。",
  "cli.config.slot.errors.unknown": '未知槽位 "{slot}"。可用槽位：{slots}。',
  "cli.config.slot.dismiss.already": '槽位 "{slot}" 已忽略，无需操作。',
  "cli.config.slot.dismiss.done":
    '已忽略 onboard 槽位 "{slot}"。运行 `fabric config onboard-reset {slot}` 可重新开启。',
  "cli.config.slot.dismiss.failed": "dismiss-slot 失败：{message}",
  "cli.config.slot.reset.not-opted": '槽位 "{slot}" 未被忽略，无需操作。',
  "cli.config.slot.reset.done":
    '已重置 onboard 槽位 "{slot}"；它将在 `fabric onboard-coverage` 中重新显示为缺失。',
  "cli.config.slot.reset.failed": "onboard-reset 失败：{message}",
  "cli.config.errors.uninit-workspace.message":
    "工作区尚未初始化。请先运行 `fabric install`。",
  "cli.config.errors.unknown-field": "未知字段选择 — 已跳过。",
  "cli.config.errors.no-store-target":
    "本仓库没有绑定可写的团队 store — 先跑 `fabric store bind <alias>` 再设置这个知识库级配置。",
  "cli.config.errors.no-project-id":
    "本仓库还没有 project_id — 先跑 `fabric install`，或改用 --scope defaults 写到全机器默认。",
  "cli.config.errors.no-enum-options": "该字段没有可选枚举值 — 已跳过。",
  // 11 个面板字段标签（A 组 2 个 + B 组 8 个 + C 组 1 个）。
  "cli.config.fields.fabric_language.label": "语言",
  "cli.config.fields.fabric_language.description":
    "Fabric 的全局语言基调（界面与知识统一），保存到 ~/.fabric/fabric-global.json。",
  "cli.config.fields.default_layer_filter.label": "默认检索范围",
  "cli.config.fields.default_layer_filter.description":
    "AI 找知识时默认翻哪一层：team 只翻团队库 / personal 只翻个人库 / both 两个都翻（默认）。",
  "cli.config.fields.archive_hint_hours.label": "归档提醒：隔多久提一次",
  "cli.config.fields.archive_hint_hours.description":
    "距离上次归档超过这么多小时，就提醒你「有东西该记下来了」。调大＝更少打扰，调小＝催得更勤。",
  "cli.config.fields.archive_hint_cooldown_hours.label":
    "归档提醒：被忽略后静默多久",
  "cli.config.fields.archive_hint_cooldown_hours.description":
    "你没理会归档提醒后，它闭嘴这么多小时再说第二次。防止同一件事反复念。",
  "cli.config.fields.archive_edit_threshold.label":
    "归档提醒：改多少次文件后触发",
  "cli.config.fields.archive_edit_threshold.description":
    "累计改了这么多次文件就提醒归档（和上面的小时数是「或」的关系，谁先到算谁）。调小＝更早提醒。",
  "cli.config.fields.underseed_node_threshold.label": "知识库「太空」的门槛",
  "cli.config.fields.underseed_node_threshold.description":
    "知识条目少于这个数，Fabric 认为知识库还没建起来，会建议你先补一批。属于知识库自身属性，写在团队 store 里、全团队共享。",
  "cli.config.fields.review_hint_pending_count.label":
    "待审提醒：积压多少条时提",
  "cli.config.fields.review_hint_pending_count.description":
    "AI 归档的草稿要你过目才进库。攒到这么多条就提醒你去审一批。",
  "cli.config.fields.review_hint_pending_age_days.label":
    "待审提醒：放多少天时提",
  "cli.config.fields.review_hint_pending_age_days.description":
    "有草稿放了这么多天还没审，就提醒你。防止少量草稿一直被遗忘。",
  "cli.config.fields.review_stale_pending_days.label":
    "待审草稿「放太久」的天数",
  "cli.config.fields.review_stale_pending_days.description":
    "审核时，超过这个天数的草稿会被单独拎出来让你「要么处理、要么丢掉」，不让长尾堆积。",
  "cli.config.fields.maintenance_hint_days.label": "体检提醒：隔多少天提一次",
  "cli.config.fields.maintenance_hint_days.description":
    "距离上次跑 `fabric doctor` 超过这么多天，提醒你做一次知识库体检。",
  "cli.config.fields.maintenance_hint_cooldown_days.label":
    "体检提醒：被忽略后静默多少天",
  "cli.config.fields.maintenance_hint_cooldown_days.description":
    "你没理会体检提醒后，它闭嘴这么多天再说第二次。",
  "cli.config.fields.audit_mode.label": "改动审计严格度",
  "cli.config.fields.audit_mode.description":
    "检查「人工锁定的内容被改动」时有多严：strict 严格拦 / warn 只警告（推荐）/ off 不检查。",
  "cli.config.fields.nudge_mode.label": "提示音量",
  "cli.config.fields.nudge_mode.description":
    "你能看到多少提示：silent 全静音 / minimal 只留关键 / normal 正常 / verbose 什么都说。只影响你看到的，不影响 AI 拿到的知识——静音也不会让 AI 变笨。",
  "cli.config.fields.cite_policy_enabled.label": "改文件前先查知识库",
  "cli.config.fields.cite_policy_enabled.description":
    "开启后，AI 改文件前会被提醒先查一下相关知识（不阻塞，只提醒）。关掉＝完全不提。",
  "cli.config.fields.self_archive_policy_enabled.label": "AI 自动提议归档",
  "cli.config.fields.self_archive_policy_enabled.description":
    "开启后，AI 察觉到「这个决定值得记下来」时会自己发起归档（仍需你审核才进库）。关掉＝只有你主动叫它才归档。",
  "cli.config.fields.cite_recall_nudge.label": "未查知识库时提醒",
  "cli.config.fields.cite_recall_nudge.description":
    "AI 没查知识库就动手改文件时，给一句软提醒。嫌啰嗦可以关掉，不影响归档和检索。",
  "cli.config.fields.fabric_event_retention_days.label": "活动日志保留天数",
  "cli.config.fields.fabric_event_retention_days.description":
    "本机活动流水保留多久（7 精简 / 30 均衡 / 90 便于回溯）。超期的会归档到旁边的文件，不会直接删掉。",
  "cli.config.fields.embed_enabled.label": "语义检索（按意思找，不只按词）",
  "cli.config.fields.embed_enabled.description":
    "开启后，问法和原文用词不一样也能找到（中文尤其明显）。注意这只是意图开关：真正生效还要 server 能加载 fastembed、模型已下载（首次检索时自动下到 ~/.fabric/cache/embed）。用 `fabric info recall` 看实际状态。",
  "cli.config.fields.fusion.label": "检索排序方式",
  "cli.config.fields.fusion.description":
    "关键词命中和语义相似怎么合成排名：auto 自动挑（默认，推荐）/ rrf 两者平权（语义更管用）/ additive 关键词主导。没把握就留 auto——它会在语义通道真的出分时才启用 rrf。",

  "cli.doctor.description":
    "运行 Fabric 目标态诊断（meta 同步、知识索引、bootstrap、events ledger、human-lock 漂移）",
  "doctor.section.fixable": "可修复错误：",
  "doctor.section.fix-knowledge-mutations": "知识侧变更：",
  // flat-design follow-up: doctor 剩余的 UI-shell 文案(TL;DR 头、--fix 变更计划、
  // 过滤版 --help)从硬编码英文搬进 i18n,让整个 `fabric doctor` 输出跟随机器语言。
  // USAGE/OPTIONS/EXAMPLES 标签保持英文,与其它命令 --help 的 citty renderUsage 对齐。
  "doctor.digest.todo": "待处理 ({count})",
  "doctor.digest.clean": "全部 {count} 项检查通过 —— 无需处理",
  "doctor.digest.summary":
    "{todo} 项待处理 · {ok} 项通过 · 贡献者诊断见 --verbose",
  "doctor.digest.more-verbose": "另有 {count} 项贡献者诊断 —— 见 --verbose",
  // store 诊断(多 store 健康,即 `● 存储健康` 分组)—— 与 doctor.check.* 对齐 i18n;
  // 文案通过插值带上 store alias / 计数。
  "doctor.store.no-global-config":
    "无全局 Fabric 配置 —— 运行 `fabric install --global <url>`",
  "doctor.store.missing-required":
    "必需 store '{id}' 未挂载;运行 `fabric store mount`",
  "doctor.store.unbound":
    "store '{alias}' 已挂载但未绑定到本项目 — 粘贴执行: `fabric store bind {alias}` 然后 `fabric store switch-write {alias}`",
  "doctor.store.empty":
    "已绑定 store 知识条数为 0（{stores}）——在 seed 或 clone 有内容前无法 first-hit；运行 `fabric first-hit --seed`（空本地库）或绑定带内容的远程 team store",
  "doctor.store.write-target-mismatch":
    "活动写库 '{alias}' 不是本项目的有效 team 写目标 —— 运行 `fabric store switch-write <已挂载 team 别名>`",
  "doctor.store.hooks-missing":
    "知识已有但 SessionStart/PreToolUse hooks 缺失 —— 重跑 `fabric install`",
  "doctor.store.alias-drift":
    "by-alias 可读性软链与注册表不同步:{refs};运行 `fabric doctor --fix` 修复 ~/.fabric/stores/by-alias/",
  "doctor.store.local-only": "store '{alias}' 仅本地;加一个 git remote 以备份",
  "doctor.store.executable":
    "store '{alias}' 含可执行/脚本文件({files})—— store 仅存数据;Fabric 从不运行它们 (S65)",
  "doctor.store.active-personal-invalid":
    "活动 personal store '{store}' 不是已挂载的 personal store;运行 `fabric store switch-personal <alias>` 或 `fabric doctor --fix`",
  "doctor.store.active-personal-unset":
    "已挂载 {count} 个 personal store 但无活动指针;运行 `fabric store switch-personal <alias>` 选一个(或 `fabric doctor --fix` 默认取第一个)",
  "doctor.store.related-broken":
    "{count} 条 `related` 链接指向语料中不存在的 id:{samples}{overflow} —— 通过 `fab_review` (modify) 修复 related 边,或编辑条目 frontmatter",
  "doctor.store.related-hub":
    "related 图谱枢纽(前 {shown} / 共 {total} 个被引用):{top}",
  "doctor.store.config-key-relocated":
    "本仓配置仍留有已搬迁的键 '{key}' —— 策略已归 ~/.fabric/fabric-global.json(偏好类) 或 store 的 store-config.json(语料类);此处的值不再生效,可删除",
  "doctor.store.unreachable":
    "store '{alias}' 在 read-set 中但磁盘上不可达({reason});运行 `fabric store mount` / 重新 clone,再跑 `fabric doctor`",
  "doctor.store.unreachable-bound":
    "已绑定 store 的磁盘目录缺失：{stores} — 请 re-clone 或 remount，再跑 fabric doctor",
  "doctor.store.consumption-heatmap":
    "消费热区(近 {days}d,{consumed}/{total} 条被读,跨 {windows} 个窗口):{top}",
  "doctor.store.consumption-zero":
    "{count} 条在近 {days}d 内从未被消费:{sample}{overflow} —— 通过 `fab_review` 考虑淘汰(消费量只是信号之一,非陈旧的证据)",
  "doctor.store.overflow-more": ", …(+{count} 条)",

  "doctor.check.knowledge_body_altitude_dump.name": "知识正文 altitude",
  "doctor.check.knowledge_body_altitude_dump.ok":
    "未发现 dump 形态的知识正文。",
  "doctor.check.knowledge_body_altitude_dump.message.singular":
    "1 条 dump 形态知识正文: {detail}",
  "doctor.check.knowledge_body_altitude_dump.message.plural":
    "{count} 条 dump 形态知识正文(例如 {detail})",
  "doctor.check.knowledge_body_altitude_dump.remediation":
    "改写成可复用的 decision/pitfall/guideline altitude(带 ## 结构),不要贴 session 流水;经 fabric-archive / fab_propose 重归档",
  "doctor.check.knowledge_body_altitude_dump.scan_error":
    "正文 altitude 扫描失败({detail});doctor 无法确认语料干净。",
  "doctor.check.knowledge_summary_session_voice.name": "知识 summary 叙述人称",
  "doctor.check.knowledge_summary_session_voice.ok":
    "未发现会话纪要式的 summary。",
  "doctor.check.knowledge_summary_session_voice.message.singular":
    "1 条 summary 写成了会话纪要: {detail}",
  "doctor.check.knowledge_summary_session_voice.message.plural":
    "{count} 条 summary 写成了会话纪要(例如 {detail})",
  "doctor.check.knowledge_summary_session_voice.remediation":
    "summary 是 fab_recall 唯一投递的字段,写成独立成句的结论(做什么 + 为什么),去掉「用户/我/本次」这类会话人称;经 fabric-review modify-content 改写",
  "doctor.check.knowledge_summary_session_voice.scan_error":
    "summary 人称扫描失败({detail});doctor 无法确认语料干净。",
  "doctor.check.knowledge_body_dedup.name": "知识正文去重(v-next)",
  "doctor.check.knowledge_body_dedup.ok":
    "未发现旧格式正文段落或废弃 frontmatter(## Summary / ## Evidence / ## Why proposed / ## Session context / tech_stack 均已清理)。",
  "doctor.check.knowledge_body_dedup.message.singular":
    "1 条条目含旧格式正文段落或废弃 frontmatter: {detail}",
  "doctor.check.knowledge_body_dedup.message.plural":
    "{count} 条条目含旧格式正文段落或废弃 frontmatter(例如 {detail})",
  "doctor.check.knowledge_body_dedup.remediation":
    "运行 `fabric doctor --fix` 去除冗余正文段落、将 ## Session context 重命名为 ## Context、并将 tech_stack 合并到 tags。",
  "doctor.check.knowledge_body_dedup.scan_error":
    "正文去重扫描失败({detail});doctor 无法确认语料干净。",
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
  "doctor.help.footer":
    "运行 `fabric doctor` 查看完整诊断报告。审计 → `fabric audit`。",
  // flat-design-system Wave5 (TASK-005): 重排后的 doctor C-圆点分组标题
  // (`● 存储健康` / `● 检查项`),取代原硬编码 sectionBar 字面量。
  "doctor.group.store-health": "存储健康",
  "doctor.group.checks": "检查项",
  // v2.0.0-rc.29 REVIEW (codex LOW-2): F2 的 payload 阈值之前只出现在 JSON envelope，
  // 人类输出看不到，导致改了 mcpPayloadLimits 之后没法用 `fabric doctor` 快速确认是否生效。
  "doctor.section.payload-limits": "MCP payload 阈值：",
  "doctor.payload-limits.line":
    "warn={warnKb} KB, hard={hardKb} KB (来源: {source})",
  // rc.20 TASK-07: cite-coverage 人类可读格式化键。
  "doctor.section.cite-coverage": "Cite 覆盖率:",
  "doctor.cite.header": "起始 {since} (政策激活时间 {marker})",
  "doctor.cite.warning.justActivated":
    "本次首次激活 Cite policy,暂无历史数据。",
  "doctor.cite.metric.editsTouched": "编辑触达数",
  "doctor.cite.metric.qualifyingCites": "合格 cite 数",
  "doctor.cite.metric.recalledUnverified": "已标注 applied 但未验证",
  "doctor.cite.metric.expectedButMissed": "应查没查",
  "doctor.cite.metric.totalTurns": "总回合数",
  "doctor.cite.metric.complianceRate": "cite 合规率（含 KB:none[reason]）",
  "doctor.cite.metric.complianceNA": "N/A（无应 cite 回合）",
  "doctor.cite.metric.uncorrelatableEdits":
    "无法关联的编辑（缺 session_id —— hook 过期?请跑 `fabric install`）",
  "doctor.cite.metric.recallCoverage":
    "recall 覆盖率（改前有相关 fab_recall 的编辑占比）",
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
  "cite-coverage.contract.hard_violated":
    "硬性违规（操作符未匹配 session 编辑）",
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
  "cli.doctor.args.yes.description":
    "跳过 --fix 知识侧安全确认；非 tty 调用必须显式设置该标记，或在环境变量中设置 FABRIC_NONINTERACTIVE=1。",
  // rc.35 TASK-12 (P0-11): --verbose 展开 maintainer 受众的 remediation。
  "cli.doctor.args.verbose.description":
    "展开全部 action hint,包括 maintainer 受众的(Fabric 贡献者修源码用)。默认 npm 终端用户视图会把这些折叠。",
  // rc.20 TASK-05: --cite-coverage 报告参数；只读，与 --fix/--fix-knowledge 互斥。
  // v2.0.0-rc.24 TASK-10: --layer 过滤 cite 合约审计的知识层 (team|personal|all)。
  "cli.doctor.args.layer.description":
    "按知识层过滤 cite 合约审计 (team|personal|all)",
  "doctor.conflict.header": "知识冲突体检",
  "doctor.conflict.none": "未发现可疑的矛盾/重复条目对",
  "doctor.conflict.summary":
    "{candidates} 个候选对, {conflicts} 个判定为矛盾 (相似度 ≥ {threshold})",
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
  "cli.doctor.args.dry-run.description":
    "与 --enrich-descriptions --auto 或 --fix 搭配:仅预览改动计划,不写入磁盘。fix-dry-run 输出与 --fix 相同的 fixable_errors 列表,但不执行任何 mutation。",
  // v2.0.0-rc.33 W4-B1 (T6 P2): --fix --dry-run banner — 出现在 report 之前, 让用户明确没有发生 mutation。
  "cli.doctor.fix-dry-run-banner":
    "[dry-run] 未应用任何 mutation。下方 fixable_errors 列表就是 `fabric doctor --fix` 会处理的项;去掉 --dry-run 再跑可实际修复。",
  "cli.doctor.unbound-project-backfilled":
    "已回填 store '{alias}' 的 project-scope 绑定 → project '{project}'(铸 project_id + active_project)。",
  "doctor.enrich.allComplete":
    "所有正式知识条目均已包含 intent_clues / impact / must_read_if。",
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
  "doctor.check.bootstrap_anchor.ok":
    "repo root 下已存在 Bootstrap anchor：{present}。",
  // v2.0.0-rc.33 W3-2 (T6 #5): 文案显式引用 message 内已列出的 detail (file 名), 让用户直接 rm 而非自己去 grep 找。baseline pipeline 已 rc.23 移除, 没有 auto-fix。
  "doctor.check.forensic.name": "扫描证据",
  "doctor.check.forensic.message.missing.singular":
    "{error} 实时扫描检测到 {frameworkKind}，共有 {count} 个入口点。",
  "doctor.check.forensic.message.missing.plural":
    "{error} 实时扫描检测到 {frameworkKind}，共有 {count} 个入口点。",
  "doctor.check.forensic.message.missing-default":
    ".fabric/forensic.json 缺失。",
  "doctor.check.forensic.message.invalid-default":
    ".fabric/forensic.json 无效。",
  "doctor.check.forensic.remediation":
    "运行 `fabric install` 重新生成 .fabric/forensic.json。",
  "doctor.check.forensic.ok": ".fabric/forensic.json 对 {frameworkKind} 有效。",
  // rc.35 TASK-09 (P0-14): 人话化的 schema 解析失败消息。
  // v2.0.0-rc.33 W3-2 (T6 #12): 项目规则禁止手动编辑 agents.meta.json (见 .fabric/AGENTS.md); 改引导用户跑 doctor --fix 走 reconcile 路径 (rc.31+ 兼容自动剔除外部 refs)。
  "doctor.check.event_ledger.name": "事件账本",
  "doctor.check.event_ledger.message.missing": ".fabric/events.jsonl 缺失。",
  "doctor.check.event_ledger.remediation.missing":
    "运行 `fabric doctor --fix` 创建 .fabric/events.jsonl。",
  "doctor.check.event_ledger.message.not_writable-default":
    ".fabric/events.jsonl 不可写。",
  "doctor.check.event_ledger.remediation.not_writable":
    "检查 .fabric/events.jsonl 的文件权限，并确认没有其他进程持有写锁。",
  "doctor.check.event_ledger.message.invalid-default":
    ".fabric/events.jsonl 无效。",
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
    "运行 `fabric doctor --fix` —— 会按 ~/.fabric/fabric-global.json 中 defaults.fabric_event_retention_days(7|30|90) 轮转 events.jsonl，并 flush metrics.jsonl。若告警仍持续，再重启 MCP server 让 startMetricsFlush + startRotationTick 重新调度。若 metric_leak 命中，检查最近代码是否绕过 bumpCounter 直接写了 metric-managed event_type。",
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
    "编辑 `packages/cli/templates/skills/<slug>/SKILL.md` frontmatter `description:` 字段: (1) 非空; (2) <60 token (chars/3 估算, 约 180 字符); (3) 至少 1 个中文 trigger 短语; (4) 至少 1 个英文 trigger 短语; (5) 明确 anti-trigger,如 `NOT PR review` / `NOT code review` / `不是...`。重新跑 `fabric install` 同步两端。",
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
  // v2.0.0-rc.33 W3-2 (T6 #27): 走 fabric-review modify 流程让 canonical id allocator 重新分配, 而非让用户自己选 id (易撞 counter, 难手算)。
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
  "doctor.check.store_orphan.ok": "~/.fabric/stores 下没有未登记的孤儿 store。",
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
  "doctor.check.preexisting_root_files.ok":
    "project root 未检测到 CLAUDE.md 或 AGENTS.md。",
  "doctor.check.preexisting_root_files.message":
    "project root 检测到 {files}。这些 root files 不会被 Fabric MCP 自动加载。",
  "doctor.check.preexisting_root_files.remediation":
    "如果希望这些 knowledge 内容在 MCP 响应中可用，请将其移动到 mounted store 的 `knowledge/{type}/` tree。",
  // v2.0.0-rc.33 W3-2 (T6 #34): 同 stable_id_collision — 走 fabric-review modify 让 allocator 分配新 id, 不让用户手算。
  // v2.0.0-rc.33 W3-2 (T6 #35): 加 skill 入口 (`/fabric-review modify <id>`) 让用户知道怎么 invoke。
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
  // 装到磁盘但没在客户端配置里注册的 hook 是完全哑的, doctor 之外没有任何地方能发现。
  "doctor.check.hooks_wired.name": "客户端 hooks 注册",
  "doctor.check.hooks_wired.ok.skipped":
    "未找到任何客户端配置目录（.claude/ / .codex/）；跳过 hooks_wired 检查。",
  "doctor.check.hooks_wired.ok.wired":
    "每个已安装客户端的 hook 配置都注册了全部 fabric hook。",
  "doctor.check.hooks_wired.message.config_missing":
    "客户端目录存在但 hook 配置缺失：{configs}。fabric install 在这里从未跑完，或文件被外部删除 —— 该客户端的所有 fabric hook 均已失效。",
  "doctor.check.hooks_wired.message.config_unparseable":
    "hook 配置存在但不是合法 JSON：{configs}。客户端会静默忽略无法解析的配置，因此里面的所有 hook —— fabric 的和你自己的 —— 全部失效。",
  "doctor.check.hooks_wired.message.incomplete":
    "hook 配置缺少 fabric hook 注册：{missing}。这些 hook 已在磁盘上，但永远不会被调用。",
  "doctor.check.hooks_wired.remediation":
    "运行 `fabric doctor --fix`（或 `fabric install`）重新注册缺失的 hook；两者都幂等，只补空槽。",
  "doctor.check.hooks_wired.remediation.config_unparseable":
    "`fabric doctor --fix` 会把无法解析的文件原样保留在旁边，另写一份含 fabric hooks 的新配置。坏文件里你自己的设置需要手工合并回去 —— 先看一眼保留的副本。",
  // of installed *.cjs hook files (one layer below hooks_wired).
  "doctor.check.hooks_runtime.name": "Hooks 运行时健康",
  "doctor.check.hooks_runtime.ok.skipped":
    "未发现已安装的 hook 文件（.claude/hooks/ / .codex/hooks/ 都缺）；跳过 hooks_runtime 检查。",
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
  "doctor.check.hooks_content_drift.ok.skipped":
    "未发现跨客户端共存的 hook 文件（单 client 安装或全部缺失）；跳过 hooks_content_drift 检查。",
  "doctor.check.hooks_content_drift.ok.aligned":
    "已扫描 {count} 个 hook 副本，跨 client (.claude / .codex) sha256 全部一致。",
  "doctor.check.hooks_content_drift.message":
    "{count} 个 hook basename 在 client 之间内容 drift；首例：{first_basename}（涉及 {first_clients}）。`fabric install` 复制同一模板到三 client，drift 通常来自手动编辑。",
  "doctor.check.hooks_content_drift.remediation":
    "运行 `fabric install` 把所有 client 的 hook 副本恢复到 canonical 模板。若你确实需要 client-specific hook 行为，建议改 lib/ 共享脚本或 templates/hooks/configs/ 配置而非直接编辑安装后的 .cjs。",
  // W2 #16: install_copy_drift — 安装副本 vs `fabric install` 写下的 sha256 清单。
  // 仅检测不修复:server 够不到 CLI 模板,不能承诺 --fix(KT-PIT-0016)。
  "doctor.check.install_copy_drift.name": "安装副本漂移",
  "doctor.check.install_copy_drift.ok.no_manifest":
    "尚未记录安装清单,跳过 install_copy_drift 检查。重跑 `fabric install` 即可开始跟踪安装副本。",
  "doctor.check.install_copy_drift.ok.aligned":
    "{count} 个安装文件与 fabric {version} 写下的清单全部一致。",
  "doctor.check.install_copy_drift.message.unreadable":
    "{path} 存在但不是可读的安装清单(损坏,或由不兼容版本写入),无法校验安装副本。",
  "doctor.check.install_copy_drift.message.drifted":
    "{tracked} 个安装文件中有 {count} 个已不再等于 fabric {version} 写下的内容;首个:{first_path}({first_kind})。两端 client 可能一起变旧,所以跨端一致性检查抓不到这类漂移。",
  "doctor.check.install_copy_drift.remediation":
    "运行 `fabric install` 从 canonical 模板恢复安装副本(幂等)。若你是有意改了某个安装后的文件,请把改动移进 packages/cli/templates/ —— install 会覆盖就地编辑。",
  // W2 #9: mcp_root_pin_managed —— 老版本 installer 写下的 FABRIC_PROJECT_ROOT 钉。
  // 这条可修:删一个 env 键不需要 CLI 模板,server 够得到。
  "doctor.check.mcp_root_pin.name": "MCP 项目根钉",
  "doctor.check.mcp_root_pin.ok.clean":
    "没有任何 MCP client 配置带着 installer 写下的 FABRIC_PROJECT_ROOT 钉;server 会动态解析项目根。",
  "doctor.check.mcp_root_pin.message.stale":
    "{count} 个 MCP client 配置带着老版本 fabric installer 写下的 FABRIC_PROJECT_ROOT 钉,其中 {config} 钉的是 {pinned} —— 不是本项目。MCP server 会静默地去读写那个项目。",
  "doctor.check.mcp_root_pin.message.aligned":
    "{count} 个 MCP client 配置带着老版本 fabric installer 写下的 FABRIC_PROJECT_ROOT 钉({config} 钉的是 {pinned})。它今天恰好指向本项目,但这个值是冻结的:一旦目录搬家,或用户级配置里的钉被别的 repo 撞上,server 就会静默服务错的项目。",
  "doctor.check.mcp_root_pin.remediation":
    "跑 `fabric doctor --fix` 删掉 installer 写的钉(先对每个配置做带校验的备份),让项目根重新动态解析。你自己设的钉(标记为 `operator:v1` / `project:v1`)不会被动。",
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
    'stable_id "{stableId}" 被声明在 {fileCount} 个文件中:{files}。请编辑其中一个 knowledge file,改用唯一 stable_id。',
  "doctor.check.stable_id_collision.message.plural":
    '检测到 {count} 个 stable_id collisions。首个:"{stableId}" 位于 {files}。请编辑其中一个 knowledge file,改用唯一 stable_id。',
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
  "doctor.check.relevance_paths_drift.remediation_with_sample":
    "审阅该 entry 是否仍然相关 — 样本 {sample};使用 `fab_review.modify` 刷新 anchors,或使用 `fab_review.reject` 归档。",
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
    '{count} 条 write_route 指向未绑定的 store({routes});fab_propose 在这些 scope 上会报 "no write-target store resolved"。',
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
  // legacy_fabric_cache_dir_detected — 老版 recall engine 把 BM25/vector 缓存
  // 放 `.fabric/cache/{bm25,vectors}`;unify-fabric-cache-dir 后统一到
  // `.fabric/.cache/` 与 hook sidecar 同处,一条 .gitignore 覆盖两者。老数据
  // 完好,--fix 仅 rename 迁移。
  "doctor.check.legacy_fabric_cache_dir_detected.name":
    "老版 .fabric/cache/ 目录",
  "doctor.check.legacy_fabric_cache_dir_detected.ok":
    "Recall 缓存已在 .fabric/.cache/ 下,无残留 .fabric/cache/{bm25,vectors}。",
  "doctor.check.legacy_fabric_cache_dir_detected.message":
    "发现 {count} 个老版 recall 缓存目录({dirs})。这些是 unify-fabric-cache-dir 之前的位置;磁盘上的 BM25 快照 / 向量 embedding 数据完好,rename 即可保留。",
  "doctor.check.legacy_fabric_cache_dir_detected.remediation":
    "跑 `fabric doctor --fix` 把每个老目录 rename 到 `.fabric/.cache/` 对应位置(幂等;若新路径已有更新数据则跳过)。不涉及重新 embed,快照文件原样迁移。",
  "doctor.check.skill_md_yaml_invalid.name": "Skill markdown YAML",
  "doctor.check.skill_md_yaml_invalid.ok":
    "所有 .claude/.codex SKILL.md frontmatter values 都能按 strict YAML 解析。",
  "doctor.check.skill_md_yaml_invalid.message.singular":
    "{count} 个 SKILL.md frontmatter value 包含未加引号的 ': '，strict YAML parsers 会拒绝（Claude Code tolerates it；Codex CLI drops the skill at load）。首个：{detail}。",
  "doctor.check.skill_md_yaml_invalid.message.plural":
    "{count} 个 SKILL.md frontmatter values 包含未加引号的 ': '，strict YAML parsers 会拒绝（Claude Code tolerates it；Codex CLI drops the skill at load）。首个：{detail}。",
  "doctor.check.skill_md_yaml_invalid.remediation":
    '使用双引号包裹该 value（`description: "…"`），或将内部的 `key: value` token 改写为 `key=value`。',
  "doctor.check.onboard_coverage.name": "Onboard 覆盖率",
  "doctor.check.onboard_coverage.ok.complete":
    "Onboard coverage：{filledCount}/{total} ✓（opted-out：{optedOutCount}）。",
  "doctor.check.onboard_coverage.message.incomplete":
    "尚未覆盖的 onboard slots：[{missingSlots}]。{filledCount}/{total} filled；{optedOutCount} opted-out。",
  "doctor.check.onboard_coverage.remediation.incomplete":
    "运行 /fabric-archive 执行 onboard — Skill's first-run phase 会遍历项目，并为每个 unclaimed slot 提议 pending entries。",
  // v2.0.0-rc.25 TASK-10: --archive-history 子命令——按 session 维度审计归档尝试记录。
  "doctor.archive-history.header": "归档历史(最近 {sinceLabel},{count} 个会话)",
  "doctor.archive-history.empty":
    "暂无归档历史记录 (--since={sinceLabel} 窗口内)。",
  "doctor.archive-history.table.session": "会话",
  "doctor.archive-history.table.lastAttempt": "最近尝试",
  "doctor.archive-history.table.outcome": "结果",
  "doctor.archive-history.table.candidates": "候选数",
  "doctor.archive-history.table.coveredGap": "覆盖距今",
  // rc.37 NEW-33: 统一 --history <mode> 视图 (archive | fix | all)。
  "cli.doctor.errors.invalid-history-mode":
    "无效的 --history mode '{input}'。可选: archive | fix | all。",
  "doctor.history.header":
    "Doctor 历史 (mode={mode}, 近 {sinceLabel}, 共 {days} 天)",
  "doctor.history.empty":
    "--since={sinceLabel} 窗口内无 doctor 或 archive 活动 (mode={mode})。",

  "cli.install.description":
    "在目标项目中安装 Fabric（脚手架 .fabric/、bootstrap 模板、MCP 客户端配置、git hooks）",
  "cli.install.args.target.description":
    "目标项目路径。默认依次使用 --target、EXTERNAL_FIXTURE_PATH、当前目录。",
  "cli.install.args.debug.description": "将目标解析细节输出到 stderr。",
  "cli.install.args.yes.description": "接受当前安装计划并跳过 TTY 向导直接执行",
  "cli.install.args.dry-run.description":
    "仅输出安装计划，不写文件也不执行后续阶段",
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
  // v2.0.0-rc.37 NEW-26: --force-hooks-only mirror of --force-skills-only。
  "cli.install.mcp.install.local":
    "将 @fenglimg/fabric-server 安装到项目 devDependencies",
  "cli.install.mcp.local.installing":
    "正在运行 {manager} add -D @fenglimg/fabric-server...",
  "cli.install.mcp.local.installed": "已安装到 devDependencies",
  "cli.install.preflight.error.no-home": "无法确定 global root 的 home 目录",
  "cli.install.preflight.error.not-dir": "全局 Fabric root 不是目录: {path}",
  "cli.install.preflight.error.parent-not-dir":
    "全局 Fabric root 的父目录不是目录: {path}",
  "cli.install.preflight.error.not-writable":
    "{label} 不可写: {path} ({reason})",
  "cli.install.preflight.error.git-required":
    "--url 安装需要 git,但当前不可用: {reason}",
  "cli.install.preflight.label.target": "目标目录",
  "cli.install.preflight.label.global-root": "全局 Fabric root",
  "cli.install.preflight.label.global-root-parent": "全局 Fabric root 的父目录",
  "cli.install.guidance.more":
    "更多: CLI 管安装与运维, Skill 管归档与审核流程, MCP 管会话内召回。",
  "cli.install.validate.failed": "安装校验失败:{count} 个问题",
  "cli.install.validate.failed-item": "  - {error}",
  "cli.install.hooks.installed": "已装 skill×{skills} + hook×{hooks}",
  // flat-design: 扫描结果合成一行人话(框架 + 规模);版本为 unknown 时隐去,
  // 没识别出框架时退到 plain。
  "cli.install.scan.summary.framework":
    "检测到 {framework} 项目 · {files} 文件 · {entries} 入口",
  "cli.install.scan.summary.plain": "扫描完成 · {files} 文件 · {entries} 入口",
  "cli.install.rollback.feedback": "已回滚 {count} 项改动,项目保持原状。",
  "cli.install.rollback.feedback.none":
    "没有登记任何可回滚动作 —— 先前阶段可能已经留下了半成品文件(比如 .fabric/)。重跑 install 前请先检查项目目录。",
  "cli.install.stages.completed": "已完成",
  "cli.install.stages.failed": "失败",
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
  "cli.install.healthcheck.title":
    "✓ Fabric 已是最新 · {count} 阶段就绪 · 无改动",
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
  "cli.install.pipeline.desc.store":
    "绑定当前项目的 read/write store，刷新 resolved-bindings snapshot。",
  "cli.install.next-step": "{label} {message}",
  // TASK-002 (G6): 收口总结卡的单一黄金动作锚点。能力明细表收进 --verbose,
  // 这一行才是诚实的「下一步做什么」。{action} = 具体下一条命令。
  "cli.install.next-step.anchor": "下一步 → {action}",
  // flat-design (G6): 装完最该做的事是重启客户端让 MCP 生效 —— 这才是默认锚点动作;
  // --reapply 维护提示退到 --verbose。
  "cli.install.next-step.restart":
    "重启已开的 Claude Code / Codex 会话以加载 Fabric(新会话自动生效)。",
  "cli.install.next-step.nudge-mode":
    "人可见提示默认 minimal(每会话一条状态)。改它在 ~/.fabric/fabric-global.json 的 defaults.nudge_mode(silent | minimal | normal | verbose),或跑 fabric config --set nudge_mode --value silent,或 FABRIC_NUDGE_MODE=silent。",
  "cli.install.language.prompt":
    "选择 Fabric 语言（界面与知识统一使用，之后可用 fabric config 修改）：",
  "cli.install.language.option.zh-CN": "简体中文 (zh-CN)",
  "cli.install.language.option.en": "English (en)",
  "cli.install.plan.mode-banner.plan": "[mode: plan] 仅预览，不会写入文件",
  "cli.install.plan.preview-title": "Fabric 安装 dry run",
  // flat-design-system Wave4 (TASK-004): post-group ✓ 回执用的短阶段标签。
  "cli.install.capabilities.title": "客户端能力摘要",
  // C-006 (TASK-004):默认只打一行能力摘要,让收尾的 summary card 主导收口印象;
  // 完整 4×6 能力表只在 --verbose 下展开。{count} = 检测到的客户端数。
  "cli.install.capabilities.summaryLine":
    "已检测到 {count} 个客户端并完成能力配置(加 --verbose 查看逐客户端明细表)。",
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
  // C1/C5: 语义搜索交互文案统一走 t()，英文术语首现加中文 gloss。
  "cli.install.semantic.prompt":
    "启用向量语义搜索 (vector semantic search)？(首次召回 recall 时才会下载嵌入模型)",
  "cli.install.semantic.enabled":
    "语义搜索已启用 (embed_enabled=true, embed_model={model})。",
  "cli.install.semantic.already-enabled":
    "语义搜索已是启用状态 (embed_model={model})，未改动 {path}。",
  "cli.install.semantic.offer-install":
    "现在安装可选的 embedder (向量编码器) 吗？将运行 `npm i -g fastembed`（已安装则秒过）。",
  "cli.install.semantic.installing": "正在运行 `npm i -g fastembed` …",
  "cli.install.semantic.installed":
    "fastembed 安装完成。嵌入模型会在首次召回 (recall) 时自动下载（约数十–数百 MB；不上传任何 KB 数据）。",
  "cli.install.semantic.install-failed":
    "自动安装失败（{reason}）。请手动执行下面的步骤：",
  "cli.install.semantic.manual-steps":
    "  1. 安装可选 embedder (向量编码器，装到 MCP server 解析模块的位置 — 全局安装即全局):\n" +
    "       npm i -g fastembed\n" +
    "  2. 预热模型缓存 (首跑会联网下载模型权重 ~数十-数百 MB, 不上传任何 KB 数据):\n" +
    "       export FABRIC_EMBED_CACHE_DIR=~/.cache/fabric-embed   # 严格离线者预先放好权重\n" +
    "  注: 切换 embed_model 后已有向量维度/语义变化, 下次 recall 会按新模型重新嵌入 (doc 向量按文本缓存, 自动失配重算)。\n" +
    "  关闭: 编辑 .fabric/fabric-config.json 设 embed_enabled=false。",
  // C5: store onboarding 交互文案统一走 t()。
  "cli.install.store.local-store": "本地 store",
  // W2 dual-slot (TASK-002): 个人库槽 + 团队库槽 的状态 / 提示文案。团队库槽按
  // 「类别」命名(team 类),候选项显示 store 的真实 alias —— 文案 MUST NOT 暗示
  // 该库必须叫 'team'(team 是类别非别名,守 KT-MOD-0001 命名撞轴)。
  "cli.install.store.slot.personal.status": "个人库(本机全局): '{alias}' ✓",
  "cli.install.store.slot.personal.absent": "个人库(本机全局): 尚未建立",
  "cli.install.store.slot.personal.multi-none":
    "个人库(本机全局): 已挂 {count} 个,尚未选定 active",
  "cli.install.store.slot.personal.multi-prompt":
    "选择本机当前要用的 personal store(active):",
  "cli.install.store.slot.personal.multi-active-label":
    "'{alias}'(当前 active)",
  "cli.install.store.slot.personal.multi-switch-label": "切到 '{alias}'",
  "cli.install.store.slot.personal.multi-new-label": "新建本地 personal store",
  "cli.install.store.slot.personal.multi-new-hint":
    "全新空 personal store,并设为 active",
  "cli.install.store.slot.personal.new-alias": "新 personal store 的别名:",
  "cli.install.store.slot.personal.switched":
    "已将本机活动 personal store 切到 '{alias}'",
  "cli.install.store.slot.team.status": "团队库(team 类): '{alias}'{source} ✓",
  "cli.install.store.slot.team.empty": "团队库(team 类): 尚未绑定",
  "cli.install.store.slot.team.prompt": "为本项目选择团队知识库(team 类):",
  "cli.install.store.slot.team.switch-label": "切到已挂载: {alias}",
  // flat-design store menu:「保持当前」与「跳过」语义合并 —— 已绑定时 SKIP 行显示
  // 为 keep-label(保持当前 · 不改动),未绑定时为「跳过 · 仅用 personal store」。
  "cli.install.store.slot.team.keep-label": "保持当前: {alias} · 不改动",
  "cli.install.store.slot.team.keep-hint":
    "{source}继续用这个团队库,本次不改动绑定",
  "cli.install.store.skip-label": "跳过",
  "cli.install.store.project-pick.prompt":
    "store '{store}' 已有其它项目,且与本仓库 git 名不匹配 —— 加入已有项目还是新建?",
  "cli.install.store.project-pick.join": "加入已有:{name} ({id})",
  "cli.install.store.project-pick.new": "➕ 新建项目 {id}",
  "cli.install.store.project-pick.new-name": "新项目 id (project coordinate):",
  "cli.install.store.bound-success":
    "已把 store '{alias}' 绑定到本项目并设为写入目标 (write target)。",
  "cli.install.store.created-success":
    "已创建 store '{alias}'、绑定到本项目并设为写入目标 (write target)。",
  "cli.install.store.onboard.skip-hint": "仅用 personal store (默认)",
  "cli.install.store.onboard.join-label": "加入已有",
  "cli.install.store.onboard.join-hint":
    "从 git remote 克隆 + 绑定一个共享 store",
  "cli.install.store.onboard.create-label": "新建",
  "cli.install.store.onboard.create-hint":
    "新建一个本地 store (可选 remote 托管)",
  "cli.install.store.onboard.join-url": "共享 store 的 git remote (url):",
  "cli.install.store.onboard.alias": "新 store 的本地别名 (alias):",
  "cli.install.store.onboard.remote":
    "用于托管它的 git remote (可选 — 留空跳过):",
  "cli.install.store.unbound-note":
    "注意: 以下 store 已挂载但未绑定到本项目: {aliases}。",
  "cli.install.store.unbound-hint":
    "  运行 'fabric store bind {first}' 绑定其一。",
  // C4: personal store clone-or-new。
  // TASK-004: 首装时为额外的一次性提问(语言 / 个人库 onboarding)加的语境前缀,
  // 让用户知道这些问题只在首次设置时出现。
  "cli.install.store.firstRunContext":
    "首次设置中 —— 以下为仅首装出现的一次性选择:",
  "cli.install.store.personal.prompt":
    "本机还没有 personal store (个人知识库)。新建一个，还是从 remote 克隆你已有的？",
  "cli.install.store.personal.new-label": "新建本地 (默认)",
  "cli.install.store.personal.new-hint": "全新空 personal store",
  "cli.install.store.personal.clone-label": "克隆已有",
  "cli.install.store.personal.clone-hint":
    "从 git remote 克隆你备份的 personal store",
  "cli.install.store.personal.clone-url":
    "你的 personal store 的 git remote (url):",
  "cli.install.store.personal.cloned-success":
    "已从 remote 克隆 personal store ({uuid})。",
  "cli.install.store.personal.clone-failed":
    "克隆 personal store 失败（{reason}），改为新建本地空 store。",
  "cli.install.capabilities.none":
    "没有检测到可用于 bootstrap 或 MCP 后续接力的受支持客户端。",
  "cli.install.capabilities.header.client": "客户端",
  "cli.install.capabilities.header.bootstrap": "Bootstrap",
  "cli.install.capabilities.header.mcp": "MCP",
  "cli.install.capabilities.header.hook": "Hook",
  "cli.install.capabilities.header.skill": "Skill",
  "cli.install.capabilities.header.follow-up": "后续动作",
  "cli.install.capabilities.status.ready": "已就绪",
  "cli.install.capabilities.status.installed": "已安装",
  "cli.install.capabilities.status.supported": "已支持",
  "cli.install.capabilities.status.skipped": "已跳过",
  "cli.install.capabilities.status.failed": "失败",
  "cli.install.capabilities.status.na": "不适用",
  "cli.install.capabilities.follow-up.ready": "可在客户端继续",
  "cli.install.capabilities.follow-up.install": "安装客户端资产",
  "cli.install.capabilities.follow-up.manual": "需要手动后续处理",
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
  "cli.uninstall.args.yes.description":
    "接受当前卸载计划并跳过 TTY 向导直接执行。",
  "cli.uninstall.args.verbose.description":
    "显示每个阶段的逐路径明细计数，而非精简结果行。",
  "cli.uninstall.args.unbind-store.description":
    "同时解绑本项目对团队 store 的绑定（清空 .fabric/fabric-config.json 中的绑定）。~/.fabric/stores/ 下的全局 store 永不删除。",
  "cli.uninstall.args.dry-run.description":
    "仅输出卸载计划，不删除文件也不执行后续阶段。",
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
  "cli.uninstall.stages.failed-hint":
    "查看上方错误详情。加 --debug 获取更多信息。",
  "cli.uninstall.stages.uptodate": "无可移除（{count} 项已不存在）",
  // flat-design-system Wave5 (TASK-006 G3): 总结卡明细行的人话结果词，与 install 的
  // `已安装 {count} 项` / `已最新` 对称。
  "cli.uninstall.stage.cleaned-count": "已清理 {count} 项",
  "cli.uninstall.summary.title": "卸载摘要",
  "cli.uninstall.summary.body":
    "removed={removed} skipped={skipped} errors={errors}",
  "cli.uninstall.healthcheck.title": "✓ Fabric 已不存在 · 无可移除",
  "cli.uninstall.wizard.intro": "卸载 Fabric",
  "cli.uninstall.wizard.select.prompt":
    "要从 {target} 卸载哪些部分？(空格勾选 / 回车确认；~/.fabric/stores/ 下的全局知识 store 永不删除)",
  "cli.uninstall.wizard.select.scaffold.label": "scaffold 产物",
  "cli.uninstall.wizard.select.scaffold.hint": ".fabric/ 下的脚手架文件",
  "cli.uninstall.wizard.select.bootstrap.label": "Skills 与 hooks",
  "cli.uninstall.wizard.select.bootstrap.hint":
    "各客户端的 skills 与 hook 脚本 + 配置",
  "cli.uninstall.wizard.select.mcp.label": "MCP 客户端注册",
  "cli.uninstall.wizard.select.mcp.hint": "从各客户端反注册 fabric MCP server",
  "cli.uninstall.wizard.select.store.label": "解绑团队 store（本项目）",
  "cli.uninstall.wizard.select.store.hint":
    "清空本项目的 store 绑定；全局 store 永不删除",
  "cli.uninstall.wizard.execute.confirm": "现在执行该卸载计划？[Y/n]",
  "cli.uninstall.wizard.outro": "卸载计划已确认，开始执行 Fabric uninstall...",
  "cli.uninstall.wizard.cancelled": "Fabric 卸载已在执行前取消。",
  "cli.uninstall.confirm.proceed": "确认从 {target} 卸载 Fabric？[y/N]",
  "cli.uninstall.errors.target-not-directory": "目标必须是已存在的目录：{path}",

  // v2.0.0-rc.37 Wave A2 Part 2: cli.serve.* + FABRIC_AUTH_TOKEN keys removed
  // alongside the `fabric serve` command. The HTTP package they belonged to was
  // deleted in W4 B7; restore from git history if a web UI surface returns.

  // v2.0.0-rc.29 TASK-008 (BUG-L2): onboard-coverage 国际化键。
  "cli.first-hit.description":
    "验收 install→first-hit 就绪（bind + 非空知识面）",
  "cli.first-hit.args.json.description": "机器可读 JSON 报告",
  "cli.first-hit.args.target.description": "项目根（默认 cwd）",
  "cli.first-hit.args.seed.description":
    "若 store 为空则写入最小 starter 知识条目",
  "cli.first-hit.args.paths.description": "逗号分隔的探测路径",
  "cli.first-hit.msg.ok":
    "first-hit 就绪：{stores} 个 store 共 {total} 条知识；hooks 已安装。",
  "cli.first-hit.msg.unbound":
    "unbound：本项目 read-set 未绑定任何 store，知识无法浮现。",
  "cli.first-hit.msg.no_write_target":
    "no_write_target：已有 required stores 但未设置 active_write_store。",
  "cli.first-hit.msg.empty_store":
    "empty_store：store 已绑定但规范知识文件为 0 — 空 store 不是成功路径。",
  "cli.first-hit.msg.missing_required":
    "missing_required：required_stores 中有未挂载的 store。",
  "cli.first-hit.msg.write_target_mismatch":
    "write_target_mismatch：active_write_store 不在已挂载可写 read-set 上。",
  "cli.first-hit.msg.store_unreachable":
    "store_unreachable：已绑定 store 在注册表中但磁盘目录缺失。",
  "cli.first-hit.msg.project_unsealed":
    "project_unsealed：已绑定写库但缺少 project_id/active_project — 团队知识会落成 flat（semantic_scope: team）而非项目分区。",
  "cli.first-hit.msg.no_match":
    "no_match：知识存在但探测面为空（路径/scope 过滤）。",
  "cli.first-hit.msg.hooks_missing":
    "hooks_missing：知识已在但 SessionStart/PreToolUse hooks 未安装。",
  "cli.first-hit.msg.no_project":
    "no_project：当前目录不是 Fabric 项目（缺少 .fabric/fabric-config.json）。",
  "cli.first-hit.msg.no_global":
    "no_global：缺少全局 fabric 配置 — 请先运行 fabric install --global。",

  "cli.onboard-coverage.description":
    "汇总当前工作区的 S5 onboard-slot 覆盖度。fabric-archive Skill 首跑阶段用它判断哪些项目语调槽位尚未被认领。",
  "cli.onboard-coverage.args.json.description":
    "输出机器可读的 JSON 到 stdout（替代人类可读的表格）。",
  "cli.onboard-coverage.args.target.description":
    "覆盖项目根目录（默认为当前工作目录）。",

  // W3-05 (ISS-033): 项目作用域命令输出 (whoami / store / scope-explain /
  // sync / metrics) —— 原硬编码英文, 现按项目 fabric_language 渲染。
  "cli.cmd.no-global-config":
    "未找到全局 Fabric 配置 —— 请先运行 `fabric install --global <url>`",
  "cli.whoami.stores-none": "stores: (未挂载任何 store)",
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
  "cli.info.recall.summary.off":
    "关键词模式 · 语义搜索未开 —— 详情 fabric info --recall",
  "cli.info.recall.mode.additive": "additive(关键词模式)",
  "cli.info.recall.mode.rrf": "rrf(关键词+语义)",
  "cli.info.recall.reason.forced-additive": "配置固定为关键词模式(additive)",
  "cli.info.recall.reason.auto-additive": "向量通道未就绪,自动回退到关键词模式",
  "cli.info.recall.reason.auto-rrf": "向量通道就绪,使用关键词+语义融合(rrf)",
  "cli.info.recall.reason.rrf-ready": "配置固定为 rrf,向量通道就绪",
  "cli.info.recall.reason.rrf-warn":
    "配置固定为 rrf,但向量通道未就绪 —— 单通道 rrf 反而比关键词模式差",
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
  "cli.info.recall.cached.no":
    "未缓存 —— 首次召回时下载(或运行 `fabric info --recall --warm`)",
  "cli.info.recall.vector.ready": "就绪",
  "cli.info.recall.vector.not-ready":
    "未就绪 —— 召回回退到关键词模式(BM25 / additive)",
  "cli.info.recall.warm.ok":
    "embedder 已预热:模型 '{model}' 已加载(向量维度 {dim}),缓存于 {dir}",
  "cli.info.recall.warm.fail":
    "embedder 不可用 —— 可选的 'fastembed' 包无法解析,或模型加载失败。\n  召回回退到关键词模式(BM25 / additive)。请在 server 能解析模块的位置安装 fastembed 后重试。",
  "cli.store.mount.description": "将知识 store 挂载到全局注册表",
  "cli.store.create.description": "创建并挂载本地知识 store",
  "cli.store.remove.description": "从注册表卸下 store（不删除磁盘）",
  "cli.store.explain.description": "解释 store 别名如何解析",
  "cli.store.list.description": "列出挂载的 store",
  // 一次性磁盘迁移(KT-DEC-0060 折叠面)。它们改写 scope 坐标或搬文件,
  // 没人会在日常工作里跑。
  "cli.store.backfill.description": "为存量知识回填 semantic_scope + visibility_store(并修脏 layer)",
  "cli.store.rescope.description": "改写 store 内知识条目的 semantic_scope 坐标",
  "cli.store.promote.description": "把 project 域条目提升到 team 域(项目吸收)",
  "cli.store.reroot.description":
    "把平铺的 project 域条目迁入 knowledge/projects/<id>/(git mv,保留 blame)",
  // 追加在 `fabric store --help` 末尾的说明 —— 交代进阶(meta.hidden)操作去哪了,
  // 否则只剩 list 一行会让用户以为 store 没别的能力。
  // 点组名而不是举四个命令:举例已经漂过一次(它写着 `migrate`,
  // 而当时唯一还**可见**的恰恰是那批一次性迁移),举错例子比不举更糟。
  "cli.store.help.folded-note":
    "已折叠但仍可直接调用:安装与路由(create / mount / bind / switch-write —— 由 fabric install 与 fabric-store skill 驱动),以及一次性迁移(backfill / scope / promote / reroot / migrate)。需要时直接 `fabric store <命令> --help` 查看。",
  "cli.store.list.title": "已挂载知识库",
  "cli.store.project.list.title": "store '{store}' 中的项目",
  "cli.store.project.list.empty": "(无已注册项目)",
  "cli.store.project.created": "已在 store '{store}' 注册项目 '{id}'",
  "cli.store.migrate.title": "知识坐标迁移",
  "cli.store.backfill.noop": "scope 回填:无需改动({count} 条已一致)",
  "cli.store.backfill.summary":
    "scope 回填:{changed} 条已更新,{unchanged} 条未变",
  "cli.store.backfill.scope-note":
    "{count} 条默认设为 semantic_scope: team。用 `fabric store migrate scope <store> --to project:<id> --id <id>` 把项目专属的降级。",
  "cli.store.rescope.noop": "重定 scope:无需改动({count} 条已是 '{scope}')",
  "cli.store.rescope.summary":
    "重定 scope → {scope}:{changed} 条已更新,{unchanged} 条未变",
  "cli.store.rescope.refused": "{count} 条被拒绝",
  "cli.store.reroot.noop": "reroot:无需迁移({skipped} 条保持平铺)",
  "cli.store.reroot.summary":
    "reroot:{moved} 条项目条目已迁入 knowledge/projects/<id>/",
  "cli.store.reroot.provenance-gap":
    "{count} 条经 fs rename 迁移(未跟踪 / 非 git)—— 这些条目的 git blame 历史未保留",
  "cli.store.none-mounted": "(未挂载任何 store)",
  "cli.store.mounted": "已挂载 '{alias}' (共 {count} 个 store)",
  "cli.store.created": "已创建 store '{alias}' ({uuid}) 于 {dir}",
  "cli.store.created-local-hint":
    "(仅本地 —— 稍后用 `git -C <storeDir> remote add origin <url>` 添加 remote)",
  "cli.store.no-alias": "没有别名为 '{alias}' 的 store",
  "cli.store.detached":
    "已分离 '{alias}' —— 磁盘上的 store 目录保留 (分离 ≠ 删除)",
  "cli.store.bound": "已绑定必需 store '{id}' (共 {count} 个必需)",
  "cli.store.switch-write": "已将本项目的活动写入 store 设为 '{alias}'",
  "cli.store.switch-personal": "已将本机活动 personal store 设为 '{alias}'",
  "cli.store.routed": "写入路由:scope '{scope}' → store '{alias}'",
  "cli.sync.deferred":
    "{count} 个 store 离线 —— push 已延后; 联网后重新运行 `fabric sync`",
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
  "cli.metrics.invalid-since":
    '--since: 无效的时长 "{raw}" (示例: 24h、7d、30m)',
  "cli.metrics.window": "Fabric 指标 —— 时间窗: {window}",
  "cli.metrics.window-all-time": "全部时间",
  "cli.metrics.rows-range": "  行数: {count} ({start} → {end})",
  "cli.metrics.rows": "  行数: {count}",
  "cli.metrics.no-activity":
    "  (时间窗内无计数活动 —— server 可能空闲或刚启动)",
  "cli.metrics.col.counter": "计数器",
  "cli.metrics.col.total": "总计",
  "cli.metrics.col.entry": "条目",
  "cli.metrics.section.perEntry": "按条目消费排行 (knowledge_consumed:<id>)",

  // W3-09 (ISS-035): forensic 项目扫描进度 (stderr, 仅 TTY)。

  // W4-11 (ISS-021): 统一项目扫描推荐(cli forensic + http scan 共用此 i18n key 集)。
  "scan.rec.install":
    "运行 `fabric install`，然后绑定并选择 mounted knowledge store 来承载 decisions/pitfalls/guidelines/models/processes。",
  "scan.rec.readme":
    "README 信息不足,建议在初始化访谈中补齐项目目标、运行方式和禁改区域。",
  "scan.rec.contributing":
    "补充 CONTRIBUTING.md,或在 mounted store 的 knowledge/processes/ 下记录贡献流程。",
  "scan.rec.cocos.lifecycle":
    "建议向用户确认 Cocos Creator Component 生命周期(onLoad/onEnable/start)顺序。",
  "scan.rec.cocos.human-protect":
    "建议询问 assets/prefabs 和 assets/scenes 是否属于 @HUMAN 保护区域。",
  "scan.rec.cocos.meta-lock":
    "检测到 .meta 文件,建议在 @HUMAN 锁定 .meta 不被 AI 改动。",
  "scan.rec.next": "建议确认 app/pages 路由边界和服务端组件约束。",
  "scan.rec.vite": "建议确认 src/main 入口、组件目录和构建脚本的维护边界。",
  "scan.rec.unknown": "未检测到明确框架,建议先让用户确认技术栈和主要入口。",
  "scan.rec.generic":
    "建议围绕 {kind} 的主要入口和生成目录确认 AGENTS.md 分层边界。",
};
