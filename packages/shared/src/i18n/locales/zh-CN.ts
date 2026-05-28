import type { Messages } from "../types.js";

export const zhCNMessages: Messages = {
  "cli.main.description":
    "Fabric CLI - AI 智能体协作框架。\n" +
    "\n" +
    "三步心智模型：\n" +
    "  装 (install) - fabric install   一键完成项目初始化\n" +
    "  配 (config)  - fabric config    打开交互式配置面板\n" +
    "  跑 (run)     - fabric serve     启动本地 MCP HTTP 服务\n" +
    "                fabric doctor     运行目标态诊断\n" +
    "\n" +
    "示例：\n" +
    "  fabric install                  在当前项目中安装 Fabric\n" +
    "  fabric config                   打开交互式配置面板\n" +
    "  fabric serve --port 7373        启动 MCP HTTP 服务\n" +
    "  fabric doctor --fix             修复 Fabric 派生状态\n" +
    "  fabric uninstall --dry-run      预览卸载，不删除文件",
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
  "cli.shared.target-invalid": "目标必须是已存在的目录：{target}",
  "cli.shared.template-not-found": "未找到模板：{path}",
  "cli.shared.invalid-host-empty": "无效 host：<empty>",
  "cli.shared.invalid-port": "无效端口：{value}",
  "cli.shared.error": "错误",

  "cli.approve.description": "从命令行批准已漂移的 human-lock 记录。",
  "cli.approve.args.all.description": "不提示，批准所有已漂移的 human-lock 记录。",
  "cli.approve.args.interactive.description": "逐条提示后批准已漂移的 human-lock 记录。",
  "cli.approve.args.target.description": "目标项目路径，默认为当前工作目录。",
  "cli.approve.no-drift": "未发现漂移记录。",
  "cli.approve.prompt": "批准此记录？[y/N] ",
  "cli.approve.approved-one": "已批准 {location}",
  "cli.approve.skipped-one": "已跳过 {location}",
  "cli.approve.summary": "已批准 {approved}/{total} 条漂移记录。已跳过 {skipped} 条。",
  "cli.approve.table.expected": "预期",
  "cli.approve.table.current": "当前",

  "cli.bootstrap.description": "为支持的 AI 客户端安装 Fabric 引导提示模板。",
  "cli.bootstrap.install.description": "将 Fabric 引导模板复制到各客户端的原生位置。",
  "cli.bootstrap.install.args.clients.description": "可选的逗号分隔客户端过滤器，例如 claude,cursor,codex。",
  "cli.bootstrap.install.no-targets":
    "未检测到可安装的 bootstrap 目标。可显式传入 --clients claude,cursor,codex。",
  "cli.bootstrap.install.installed": "已安装 {path}",
  "cli.bootstrap.install.skipped-header": "已跳过 {path}：Fabric Bootstrap 头部已存在。",
  "cli.bootstrap.install.prepended": "已前置写入 {path}",
  "cli.bootstrap.errors.unknown-client":
    "未知客户端\u201c{client}\u201d。请使用逗号分隔列表，例如 claude,cursor,codex。",

  "cli.config.description":
    "打开 Fabric 交互式配置面板（语言、知识层、审计模式、提示窗口、MCP 客户端配置等）。\n" +
    "\n" +
    "示例：\n" +
    "  fabric config                   打开交互式面板\n" +
    "  fabric config --target /path    编辑指定项目的配置",
  "cli.config.args.target.description": "目标项目目录（默认当前工作目录）。",
  "cli.config.clients.claude": "Claude Code CLI",
  "cli.config.install.description": "将 Fabric MCP 服务端条目安装到检测到的客户端配置中。",
  "cli.config.install.args.clients.description": "可选的逗号分隔客户端过滤器，例如 cursor,codex。",
  "cli.config.install.args.dry-run.description": "仅预览将要发生的写入操作，不修改文件。",
  "cli.config.errors.unknown-client":
    "未知客户端\u201c{client}\u201d。请使用逗号分隔列表，例如 cursor,codex。",
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
  "cli.config.write.success": "已保存 {key} = {value}",
  "cli.config.write.failure": "写入 fabric-config.json 失败：{message}",
  "cli.config.errors.uninit-workspace.message":
    "工作区尚未初始化。请先运行 `fabric install`。",
  "cli.config.errors.invalid-int": "必须是正整数。",
  "cli.config.errors.unknown-field": "未知字段选择 — 已跳过。",
  "cli.config.errors.no-enum-options": "该字段没有可选枚举值 — 已跳过。",
  // 11 个面板字段标签（A 组 2 个 + B 组 8 个 + C 组 1 个）。
  "cli.config.fields.fabric_language.label": "语言",
  "cli.config.fields.fabric_language.description":
    "Fabric 钩子与 Skill 输出使用的语言。",
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

  "cli.doctor.description":
    "运行 Fabric 目标态诊断（meta 同步、知识索引、bootstrap、events ledger、human-lock 漂移）。\n" +
    "\n" +
    "示例：\n" +
    "  fabric doctor                   只读诊断报告\n" +
    "  fabric doctor --fix             修复派生状态（meta + 索引）\n" +
    "  fabric doctor --fix-knowledge   应用知识库 lint 变更（降级 / 归档）\n" +
    "  fabric doctor --json --strict   机器可读输出，warning 视为失败",
  "doctor.section.fixable": "可修复错误：",
  "doctor.section.manual": "需手动修复：",
  "doctor.section.warnings": "警告：",
  "doctor.section.fix-knowledge-mutations": "Fix-knowledge 变更：",
  // v2.0.0-rc.29 REVIEW (codex LOW-2): F2 的 payload 阈值之前只出现在 JSON envelope，
  // 人类输出看不到，导致改了 mcpPayloadLimits 之后没法用 `fabric doctor` 快速确认是否生效。
  "doctor.section.payload-limits": "MCP payload 阈值：",
  "doctor.payload-limits.line": "warn={warnKb} KB, hard={hardKb} KB (来源: {source})",
  // rc.20 TASK-07: cite-coverage 人类可读格式化键。
  "doctor.section.cite-coverage": "Cite 覆盖率:",
  "doctor.cite.header": "起始 {since} (政策激活时间 {marker})",
  "doctor.cite.warning.justActivated": "本次首次激活 Cite policy,暂无历史数据。",
  "doctor.cite.metric.editsTouched": "Edit 触达数",
  "doctor.cite.metric.qualifyingCites": "合格 cite",
  "doctor.cite.metric.recalledUnverified": "recalled 但未验证",
  "doctor.cite.metric.expectedButMissed": "应查没查",
  "doctor.cite.metric.totalTurns": "总回合数",
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
  "cli.doctor.args.fix.description": "修复 Fabric 派生状态（meta + 索引）。",
  "cli.doctor.args.json.description": "以 JSON 输出 doctor 报告。",
  "cli.doctor.args.strict.description": "将 warning 也视为失败。",
  "cli.doctor.args.fix-knowledge.description":
    "应用知识库 lint 变更：降级孤立的规范条目、归档陈旧 draft、修正漂移的索引计数器。默认 doctor 运行仍然只读。",
  "cli.doctor.args.yes.description":
    "跳过 --fix-knowledge 的安全确认；非 tty 调用必须显式设置该标记，或在环境变量中设置 FABRIC_NONINTERACTIVE=1。",
  // rc.35 TASK-12 (P0-11): --verbose 展开 maintainer 受众的 remediation。
  "cli.doctor.args.verbose.description":
    "展开全部 action hint,包括 maintainer 受众的(Fabric 贡献者修源码用)。默认 npm 终端用户视图会把这些折叠。",
  "doctor.maintainer-hint-folded":
    "(maintainer-only remediation — 加 `fabric doctor --verbose` 查看)",
  "cli.doctor.errors.fix-knowledge-fix-mutually-exclusive":
    "--fix-knowledge 与 --fix 不可同时使用。--fix-knowledge 修改用户知识状态（降级/归档）；--fix 修复派生状态（meta/索引）。请分别运行。",
  // rc.20 TASK-05: --cite-coverage 报告参数；只读，与 --fix/--fix-knowledge 互斥。
  "cli.doctor.args.cite-coverage.description":
    "Cite 政策合规报告(只读;跳过标准检查)",
  "cli.doctor.args.since.description":
    "Cite 覆盖率统计窗口(如 7d, 24h, 30m)",
  "cli.doctor.args.client.description":
    "按客户端过滤(cc|codex|cursor|all)",
  // v2.0.0-rc.24 TASK-10: --layer 过滤 cite 合约审计的知识层 (team|personal|all)。
  "cli.doctor.args.layer.description":
    "按知识层过滤 cite 合约审计 (team|personal|all)",
  "cli.doctor.errors.cite-coverage-mutex":
    "--cite-coverage 不能与 --fix 或 --fix-knowledge 同时使用",
  "cli.doctor.errors.invalid-since":
    "--since 取值无效: {input}。预期格式 7d / 24h / 30m 或 epoch ms。",
  "cli.doctor.errors.invalid-client":
    "--client 取值无效: {input}。预期 cc / codex / cursor / all。",
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
  "cli.doctor.errors.enrich-descriptions-mutex":
    "--enrich-descriptions 不能与 --fix / --fix-knowledge / --cite-coverage 同时使用,请分别运行。",
  "doctor.enrich.allComplete":
    "所有正式知识条目均已包含 intent_clues / tech_stack / impact / must_read_if。",
  // rc.26 TASK-02a: doctor foundation-batch check messages.
  "doctor.check.bootstrap_marker_migration.name": "Bootstrap marker 迁移",
  "doctor.check.bootstrap_marker_migration.ok":
    "bootstrap 目标文件中未检测到旧 fabric:knowledge-base marker。",
  "doctor.check.bootstrap_marker_migration.message.singular":
    "{count} 个文件仍带有旧 fabric:knowledge-base bootstrap marker：{list}。",
  "doctor.check.bootstrap_marker_migration.message.plural":
    "{count} 个文件仍带有旧 fabric:knowledge-base bootstrap marker：{list}。",
  "doctor.check.bootstrap_marker_migration.remediation":
    "运行 `fabric doctor --fix` 迁移到 fabric:bootstrap marker",
  "doctor.check.bootstrap_snapshot_drift.name": "Bootstrap snapshot drift",
  "doctor.check.bootstrap_snapshot_drift.message.drift":
    ".fabric/AGENTS.md 内容与 BOOTSTRAP_CANONICAL 逐字节不一致。",
  "doctor.check.bootstrap_snapshot_drift.remediation.drift":
    "运行 `fabric doctor --fix` 恢复 canonical bootstrap snapshot",
  "doctor.check.bootstrap_snapshot_drift.ok.ok":
    ".fabric/AGENTS.md 与 BOOTSTRAP_CANONICAL 逐字节一致。",
  "doctor.check.bootstrap_snapshot_drift.ok.missing_delegated":
    ".fabric/AGENTS.md 不存在，已交由 bootstrap_anchor_missing 报告。",
  "doctor.check.managed_block_drift.name": "Managed block drift",
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
  "doctor.check.bootstrap_anchor.name": "Bootstrap anchor",
  "doctor.check.bootstrap_anchor.message.missing":
    "repo root 下 AGENTS.md 与 CLAUDE.md 都不存在。Fabric 需要在项目根目录存在 bootstrap anchor 文件。",
  "doctor.check.bootstrap_anchor.remediation.missing":
    "运行 `fabric install` 在 repo root 生成 AGENTS.md / CLAUDE.md bootstrap anchor。",
  "doctor.check.bootstrap_anchor.ok": "repo root 下已存在 Bootstrap anchor：{present}。",
  "doctor.check.baseline_filename_format.name": "Baseline 文件名格式",
  "doctor.check.baseline_filename_format.ok":
    "所有 baseline knowledge 文件都使用 canonical `${id}--${slug}.md` 文件名格式。",
  "doctor.check.baseline_filename_format.message.singular":
    "{count} 个 baseline knowledge 文件仍使用已废弃的 bare-slug 文件名格式，必须迁移为 `${id}--${slug}.md`。首个：{detail}。",
  "doctor.check.baseline_filename_format.message.plural":
    "{count} 个 baseline knowledge 文件仍使用已废弃的 bare-slug 文件名格式，必须迁移为 `${id}--${slug}.md`。首个：{detail}。",
  // v2.0.0-rc.33 W3-2 (T6 #5): 文案显式引用 message 内已列出的 detail (file 名), 让用户直接 rm 而非自己去 grep 找。baseline pipeline 已 rc.23 移除, 没有 auto-fix。
  "doctor.check.baseline_filename_format.remediation":
    "手动删除上面 message 中列出的 bare-slug baseline file(s) (例如 `rm <message 列出的 file>`);baseline pipeline 已在 rc.23 移除, 不再提供 auto-fix 路径。",
  "doctor.check.knowledge_dir_missing.name": "Knowledge layout",
  "doctor.check.knowledge_dir_missing.message.singular":
    "{count} 个必需 knowledge subdir 缺失：{list}。",
  "doctor.check.knowledge_dir_missing.message.plural":
    "{count} 个必需 knowledge subdir 缺失：{list}。",
  "doctor.check.knowledge_dir_missing.remediation":
    "运行 `fabric doctor --fix` 创建缺失的 .fabric/knowledge/* subdirectories。",
  "doctor.check.knowledge_dir_missing.ok":
    "全部 {count} 个必需 .fabric/knowledge/* subdirectories 均已存在。",
  "doctor.check.forensic.name": "Scan evidence",
  "doctor.check.forensic.message.missing.singular":
    "{error} 实时扫描检测到 {frameworkKind}，共有 {count} 个入口点。",
  "doctor.check.forensic.message.missing.plural":
    "{error} 实时扫描检测到 {frameworkKind}，共有 {count} 个入口点。",
  "doctor.check.forensic.message.missing-default": ".fabric/forensic.json 缺失。",
  "doctor.check.forensic.message.invalid-default": ".fabric/forensic.json 无效。",
  "doctor.check.forensic.remediation": "运行 `fabric install` 重新生成 .fabric/forensic.json。",
  "doctor.check.forensic.ok": ".fabric/forensic.json 对 {frameworkKind} 有效。",
  "doctor.check.agents_meta.name": "Agents metadata",
  "doctor.check.agents_meta.message.missing": ".fabric/agents.meta.json 缺失。",
  "doctor.check.agents_meta.remediation.missing":
    "运行 `fabric doctor --fix` 从 .fabric/knowledge/ 重建 agents.meta.json。",
  "doctor.check.agents_meta.message.invalid-default": ".fabric/agents.meta.json 无效。",
  // rc.35 TASK-09 (P0-14): 人话化的 schema 解析失败消息。
  "doctor.check.agents_meta.message.invalid-zod":
    ".fabric/agents.meta.json schema 校验失败 — {issues}。该文件很可能由不兼容版本的 fabric CLI 写入,或被手工编辑。",
  "doctor.check.agents_meta.message.invalid-from-old-cli":
    ".fabric/agents.meta.json schema 校验失败,因为 PATH 上的全局 `fabric` CLI ({version}) 低于最低支持版本 {minVersion}。rc.31 引入了向后兼容的 singular→plural 归一化,旧版 CLI 写出的文件自己也无法解析。",
  "doctor.check.agents_meta.remediation.invalid":
    "运行 `fabric doctor --fix` 让 reconcile 从 .fabric/knowledge/ 磁盘 ground-truth 重建 agents.meta.json（rc.31 起兼容历史 schema 的 singular knowledge_type 自动迁移到 plural；不要手动删除 agents.meta.json，会丢 counters envelope 与 promote ledger 关联）。",
  "doctor.check.agents_meta.message.stale":
    ".fabric/agents.meta.json revision {revision} 与 .fabric/knowledge 派生 revision {computedRevision} 不一致。",
  "doctor.check.agents_meta.message.stale_hash_equal":
    ".fabric/agents.meta.json 已与 .fabric/knowledge 内容一致（revision {revision}），但 mtime/counters 派生状态过期。可忽略。",
  "doctor.check.agents_meta.remediation.stale":
    "可忽略；engine 会在下一次 plan-context/get-sections 调用时自动修复。需要显式 reconcile 时运行 `fabric doctor --fix`。",
  "doctor.check.agents_meta.ok":
    ".fabric/agents.meta.json revision {revision} 已与 .fabric/knowledge 对齐。",
  "doctor.check.rule_content_refs.name": "Rule content refs",
  "doctor.check.rule_content_refs.message.unavailable":
    "agents.meta.json 有效前，无法检查 content_ref entries。",
  "doctor.check.rule_content_refs.remediation.unavailable":
    "先修复 agents.meta.json：运行 `fabric doctor --fix`。",
  "doctor.check.rule_content_refs.message.outside.singular":
    "{count} 个 content_ref entry 位于 .fabric/knowledge 外部。",
  "doctor.check.rule_content_refs.message.outside.plural":
    "{count} 个 content_ref entries 位于 .fabric/knowledge 外部。",
  // v2.0.0-rc.33 W3-2 (T6 #12): 项目规则禁止手动编辑 agents.meta.json (见 .fabric/AGENTS.md); 改引导用户跑 doctor --fix 走 reconcile 路径 (rc.31+ 兼容自动剔除外部 refs)。
  "doctor.check.rule_content_refs.remediation.outside":
    "运行 `fabric doctor --fix` 让 reconcile 自动剔除外部 content_ref (rc.31+ 兼容)。严禁手动编辑 agents.meta.json — engine 会自动 reconcile。",
  "doctor.check.rule_content_refs.message.missing.singular":
    "{count} 个 content_ref target 缺失。运行 `fabric doctor --fix` 执行 reconcile。",
  "doctor.check.rule_content_refs.message.missing.plural":
    "{count} 个 content_ref targets 缺失。运行 `fabric doctor --fix` 执行 reconcile。",
  "doctor.check.rule_content_refs.remediation.missing":
    "运行 `fabric doctor --fix` 让 agents.meta.json 与 .fabric/knowledge/ 中的现有文件 reconcile。",
  "doctor.check.rule_content_refs.ok":
    "所有 content_ref entries 都能解析到 .fabric/knowledge files。",
  "doctor.check.knowledge_test_index.name": "Knowledge-test index",
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
  "doctor.check.event_ledger.name": "Event ledger",
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
  "doctor.check.events_jsonl_health.name": "Events ledger 健康 (rc.37 Plan B 5 hard gate)",
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
    "运行 `fabric doctor --fix` 触发 rotation; 重启 MCP server 让 startMetricsFlush + startRotationTick 重新调度。若 metric_leak 命中, 检查最近代码改动是否绕过 bumpCounter API 直接 appendEventLedgerEvent 写了 4 个 metric-managed event_type 之一。",
  "doctor.check.mcp_config_in_wrong_file.name": "Claude MCP config 位置",
  "doctor.check.mcp_config_in_wrong_file.message":
    ".claude/settings.json 包含 mcpServers.fabric；此文件仅用于 hooks/permissions。运行 --fix 移除它，然后重新运行 fabric install 写入 .mcp.json。",
  "doctor.check.mcp_config_in_wrong_file.remediation":
    "运行 `fabric doctor --fix` 从 .claude/settings.json 中移除 mcpServers.fabric，然后运行 `fabric install` 写入 .mcp.json。",
  "doctor.check.mcp_config_in_wrong_file.ok":
    "mcpServers.fabric 不在 .claude/settings.json 中。",
  "doctor.check.event_ledger_partial_write.name": "Event ledger partial write",
  "doctor.check.event_ledger_partial_write.ok.skipped":
    "无需执行 partial-write 检查（ledger 缺失或不可写）。",
  "doctor.check.event_ledger_partial_write.message":
    "events.jsonl 在 byte offset {byteOffset} 处存在 partial write（{byteLength} 个 corrupted bytes）。运行 --fix 截断并保留 corrupted bytes。",
  "doctor.check.event_ledger_partial_write.remediation":
    "运行 `fabric doctor --fix` 截断 partial write 并将 events.jsonl 恢复到有效状态。",
  "doctor.check.event_ledger_partial_write.ok.clean":
    "events.jsonl 没有 partial trailing write。",
  // v2.0.0-rc.27 TASK-010 (audit §2.24): schema-compat 向前兼容警告类别。
  "doctor.check.event_ledger_schema_compat.name": "Event ledger schema 兼容性",
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
  // v2.0.0-rc.33 W3-6 (P1-13): SKILL.md token budget lint。warn > 5K / error > 10K token (chars/3 估算)。基于 Anthropic 推荐 SKILL.md 热路径 ~3K, 超过 5K 已影响 progressive disclosure;超过 10K 是阻断级 (model context 浪费 + 加载延迟)。
  "doctor.check.skill_token_budget.name": "Skill token budget",
  "doctor.check.skill_token_budget.ok":
    "所有 .claude/skills/<slug>/SKILL.md 在 token budget 内 (warn 5K / error 10K)。",
  "doctor.check.skill_token_budget.message.singular":
    "{count} 个 SKILL.md 超出 token budget: {list}。建议把详细内容下沉到 ref/ progressive disclosure。",
  "doctor.check.skill_token_budget.message.plural":
    "{count} 个 SKILL.md 超出 token budget: {list}。建议把详细内容下沉到 ref/ progressive disclosure。",
  "doctor.check.skill_token_budget.remediation":
    "将超标 SKILL.md 中的详细 phase / worked-examples / decision 表移到 `templates/skills/<slug>/ref/*.md`,SKILL.md 热路径只留 trigger gate + 关键 phase 概要;参考 W1 progressive disclosure 拆分模式。重新跑 `fabric install` 同步两端。",
  // v2.0.0-rc.33 W3-7 (P1-14): SKILL.md description 结构 lint。代理 trigger-recall (真 LLM 测要 live model, W1 已用 gemini 跑过);本 lint 抓回归: description 缺失 / 超 60 token / 缺中文 trigger / 缺英文 trigger。
  "doctor.check.skill_description.name": "Skill description quality",
  "doctor.check.skill_description.ok":
    "所有 SKILL.md description 字段结构良好 (非空 / <60 token / 中英双语 trigger)。",
  "doctor.check.skill_description.message.singular":
    "{count} 个 SKILL.md description 结构问题: {list}。description 是 host 端 auto-invoke 的主要匹配信号。",
  "doctor.check.skill_description.message.plural":
    "{count} 个 SKILL.md description 结构问题: {list}。description 是 host 端 auto-invoke 的主要匹配信号。",
  "doctor.check.skill_description.remediation":
    "编辑 `packages/cli/templates/skills/<slug>/SKILL.md` frontmatter `description:` 字段: (1) 非空; (2) <60 token (chars/3 估算, 约 180 字符); (3) 至少 1 个中文 trigger 短语; (4) 至少 1 个英文 trigger 短语。参考 W1 description rewrite 风格。重新跑 `fabric install` 同步两端。如需验证 recall, 跑 W1 的 gemini delegate (见 .workflow/.scratchpad/rc33-plan/W1-VERIFY-RESULT.md)。",
  // v2.0.0-rc.33 W3-3 (P1-3): cite-policy Goodhart 模式检测。扫 7d 内 assistant_turn_observed 事件, 4 个 anti-pattern (G1 仪式化 / G2 抄底引用 / G3 chained-from 滥用 / G5 placeholder cite)。warning 级 (启发式有 false-positive, 不阻断)。
  "doctor.check.cite_goodhart.name": "Cite-policy Goodhart",
  "doctor.check.cite_goodhart.ok":
    "过去 7d 未检测到 cite-policy Goodhart 反模式。",
  "doctor.check.cite_goodhart.message.singular":
    "检测到 {count} 个 cite-policy Goodhart 模式: {list}。",
  "doctor.check.cite_goodhart.message.plural":
    "检测到 {count} 个 cite-policy Goodhart 模式: {list}。",
  "doctor.check.cite_goodhart.remediation":
    "审阅触发的 pattern: G1 仪式化 → 同一 [recalled] cite 重复用,该把 KB 真正落到 contract; G2 抄底引用 → > 60% recalled 用 skip: 是绕过 contract, review skip reason 真实性; G3 chained-from 滥用 → chained-from 标了但没 commitment, 要补 operators 或改用其他 tag; G5 placeholder cite → 'KB: none' / [unspecified] 太多, 该用具体 sentinel 如 [no-relevant] / [not-applicable]。详细数据跑 `fabric doctor --cite-coverage --since=7d`。",
  // v2.0.0-rc.33 W4-A4 (T5 P2): draft-backlog lint。rc.32 baseline 92% entry 卡在 draft, 揭示 promote 断流。> 50% draft 触发 warning (workspace 必须 >= 10 entries 才计算比率, 避免小语料噪音)。
  "doctor.check.draft_backlog.name": "Knowledge draft backlog",
  "doctor.check.draft_backlog.ok":
    "canonical knowledge entries 中 draft 占比正常 (< 50%, 或 workspace 太小不评)。",
  "doctor.check.draft_backlog.message":
    "{draftCount}/{totalCount} ({pct}%) canonical knowledge entries 卡在 draft maturity — promote 断流 (rc.32 baseline 92%)。",
  "doctor.check.draft_backlog.remediation":
    "调 `/fabric-review` 批量审 draft entries: approve 升 verified/proven, reject 丢, modify 修。draft 长期堆积通常意味着 archive skill 产 draft 太快或 review skill 没跟上。",
  // rc.37 NEW-38: knowledge auto-promote (info surface; --fix 执行).
  "doctor.check.draft_auto_promote.name": "Knowledge auto-promote",
  "doctor.check.draft_auto_promote.ok":
    "无 settled draft 待自动 promote (draft 均未满 14 天或已被 drift 标记)。",
  "doctor.check.draft_auto_promote.message":
    "{count} 个 draft entries 已沉淀 ≥14 天且无 drift ({sample}{suffix}) — 可自动 promote 到 verified。跑 `fabric doctor --fix` 执行。",
  "doctor.check.draft_auto_promote.remediation":
    "跑 `fabric doctor --fix` 把这些 settled draft 自动升到 verified (排掉 draft_backlog); 或调 `/fabric-review` 手动逐条定夺。",
  "doctor.check.draft_auto_promote.fixed":
    "自动 promote {count} 个 settled draft entries → verified。",
  // rc.36 TASK-05 (P0-8): empty-tags ratio warn.
  "doctor.check.knowledge_tags_empty.name": "Knowledge tags coverage",
  "doctor.check.knowledge_tags_empty.ok":
    "canonical knowledge entries 中 empty tags 占比正常 (≤ 50%, 或 workspace 太小不评)。",
  "doctor.check.knowledge_tags_empty.message":
    "{emptyCount}/{totalCount} ({pct}%) canonical knowledge entries 的 `tags:` 为空 — 主题聚类与跨条目检索退化。fabric-archive / fabric-import skill 应每个 entry 产 2-4 个 tag。",
  "doctor.check.knowledge_tags_empty.remediation":
    "下一轮 archive/import 时,在 frontmatter `tags:` 写 2-4 个 kebab-case 主题词;批量补旧 entry tag 用 `/fabric-review` modify 流。",
  // rc.36 TASK-09 (P1-NEW1): drift_detected 未消化告警。
  "doctor.check.drift_unconsumed.name": "Knowledge drift unconsumed",
  "doctor.check.drift_unconsumed.ok":
    "近 30 天内 knowledge_drift_detected 事件已被对应 knowledge_demoted 消化,或事件数太少不评。",
  "doctor.check.drift_unconsumed.message":
    "近 30 天内 knowledge_drift_detected 事件 {driftCount} 次,knowledge_demoted 事件 {demoteCount} 次。drift > demote 至少 5 → 部分 drift 没被消化,KB 会缓慢失活。",
  "doctor.check.drift_unconsumed.remediation":
    "运行 `fabric doctor --fix` 触发 orphan-demote / stale-archive 自愈流,或调 `/fabric-review` 主动审 drift 标记的条目。",
  "doctor.check.meta_manually_diverged.name": "Meta manual divergence",
  "doctor.check.meta_manually_diverged.ok.unreadable":
    "agents.meta.json 不可读，跳过 divergence 检查。",
  "doctor.check.meta_manually_diverged.message.extra.singular":
    "agents.meta.json 中有 {count} 个 entry 在磁盘上没有对应文件。运行 --fix 执行 reconcile。",
  "doctor.check.meta_manually_diverged.message.extra.plural":
    "agents.meta.json 中有 {count} 个 entries 在磁盘上没有对应文件。运行 --fix 执行 reconcile。",
  "doctor.check.meta_manually_diverged.remediation.extra":
    "运行 `fabric doctor --fix` 让 agents.meta.json 与磁盘上当前的 rule files reconcile。",
  "doctor.check.meta_manually_diverged.message.hash.singular":
    "agents.meta.json 中有 {count} 个 entry 的 hash 与磁盘文件不匹配。运行 --fix 执行 reconcile。",
  "doctor.check.meta_manually_diverged.message.hash.plural":
    "agents.meta.json 中有 {count} 个 entries 的 hash 与磁盘文件不匹配。运行 --fix 执行 reconcile。",
  "doctor.check.meta_manually_diverged.remediation.hash":
    "运行 `fabric doctor --fix` 让 agents.meta.json 与当前 rule file 内容 reconcile。",
  "doctor.check.meta_manually_diverged.ok.consistent":
    "agents.meta.json 与磁盘上的 rule files 一致。",
  "doctor.check.knowledge_dir_unindexed.name": "Knowledge dir unindexed",
  "doctor.check.knowledge_dir_unindexed.message.singular":
    ".fabric/knowledge/ 中有 {count} 个 .md file 未索引到 agents.meta.json。运行 `fabric doctor --fix` 索引缺失的 knowledge files。",
  "doctor.check.knowledge_dir_unindexed.message.plural":
    ".fabric/knowledge/ 中有 {count} 个 .md files 未索引到 agents.meta.json。运行 `fabric doctor --fix` 索引缺失的 knowledge files。",
  "doctor.check.knowledge_dir_unindexed.remediation":
    "运行 `fabric doctor --fix` 索引缺失的 knowledge files。",
  "doctor.check.knowledge_dir_unindexed.ok":
    "所有 .fabric/knowledge/ .md files 都已索引到 agents.meta.json。",
  "doctor.check.stable_id_collision.name": "Stable ID collision",
  "doctor.check.stable_id_collision.message.singular":
    "stable_id \"{stableId}\" 被声明在 {fileCount} 个文件中：{files}。请编辑其中一个 knowledge file，改用唯一 stable_id。",
  "doctor.check.stable_id_collision.message.plural":
    "检测到 {count} 个 stable_id collisions。首个：\"{stableId}\" 位于 {files}。请编辑其中一个 knowledge file，改用唯一 stable_id。",
  // v2.0.0-rc.33 W3-2 (T6 #27): 走 fabric-review modify 流程让 canonical id allocator 重新分配, 而非让用户自己选 id (易撞 counter, 难手算)。
  "doctor.check.stable_id_collision.remediation":
    "调 `/fabric-review modify <message 中列出的 colliding id 之一>`, 让 canonical id allocator 自动重分配 id (会同步更新 frontmatter + counters + 历史 cross-ref)。严禁手工编辑 id frontmatter — 会撞 counter。",
  "doctor.check.stable_id_collision.ok":
    ".fabric/knowledge/ 中未发现已声明的 stable_id collisions。",
  "doctor.check.counter_desync.name": "Knowledge counter desync",
  "doctor.check.counter_desync.message.singular":
    "{count} 个 knowledge counter 与观测到的 stable_ids 不同步。{counterPath} = {current}，但检测到 {observedId}。运行 `fabric doctor --fix` bump counters。",
  "doctor.check.counter_desync.message.plural":
    "{count} 个 knowledge counters 与观测到的 stable_ids 不同步。{counterPath} = {current}，但检测到 {observedId}。运行 `fabric doctor --fix` bump counters。",
  "doctor.check.counter_desync.remediation":
    "运行 `fabric doctor --fix` 将 agents.meta.json counters 提升到观测到的最大 counter 值。",
  "doctor.check.counter_desync.ok":
    "agents.meta.json counters envelope 与观测到的 stable_ids 一致。",
  "doctor.check.preexisting_root_files.name": "Preexisting root markdown",
  "doctor.check.preexisting_root_files.ok": "project root 未检测到 CLAUDE.md 或 AGENTS.md。",
  "doctor.check.preexisting_root_files.message":
    "project root 检测到 {files}。这些 root files 不会被 Fabric MCP 自动加载。",
  "doctor.check.preexisting_root_files.remediation":
    "如果希望这些 knowledge 内容在 MCP 响应中可用，请将其移动到 `.fabric/knowledge/{type}/`。",
  "doctor.check.filesystem_edit_fallback.name": "Filesystem-edit fallback",
  "doctor.check.filesystem_edit_fallback.ok":
    "No orphan canonical knowledge entries detected；events.jsonl promotion trail 完整。",
  "doctor.check.filesystem_edit_fallback.message.synthesized.singular":
    "已为孤立 canonical entries 合成 {count} 个 knowledge_promoted event（{sample}{suffix}）。Reason='{reason}'。",
  "doctor.check.filesystem_edit_fallback.message.synthesized.plural":
    "已为孤立 canonical entries 合成 {count} 个 knowledge_promoted events（{sample}{suffix}）。Reason='{reason}'。",
  "doctor.check.filesystem_edit_fallback.remediation.synthesized":
    "这些 entries 是在 fab_review.approve 之外被移动到 .fabric/knowledge/<type>/ 的。合成 events 会恢复 audit-trail 完整性。",
  "doctor.check.orphan_demote.name": "Knowledge orphan demote",
  "doctor.check.orphan_demote.ok":
    "没有 canonical knowledge entries 超过按 maturity 设定的 inactivity threshold。",
  "doctor.check.orphan_demote.message.singular":
    "{count} 个 canonical knowledge entry 超过按 maturity 设定的 inactivity threshold（stable={stableDays}d / endorsed={endorsedDays}d / draft={draftDays}d）。首个：{detail}。",
  "doctor.check.orphan_demote.message.plural":
    "{count} 个 canonical knowledge entries 超过按 maturity 设定的 inactivity threshold（stable={stableDays}d / endorsed={endorsedDays}d / draft={draftDays}d）。首个：{detail}。",
  "doctor.check.orphan_demote.remediation":
    "运行 `fabric doctor --fix-knowledge`将 orphan entries 降级一个 maturity tier。",
  "doctor.check.stale_archive.name": "Knowledge stale archive",
  "doctor.check.stale_archive.ok":
    "没有 draft knowledge entries 超过额外的 stale-archive quiet window。",
  "doctor.check.stale_archive.message.singular":
    "{count} 个 draft knowledge entry 已超过 demote+{additionalDays}d 额外 quiet window。首个：{detail}。",
  "doctor.check.stale_archive.message.plural":
    "{count} 个 draft knowledge entries 已超过 demote+{additionalDays}d 额外 quiet window。首个：{detail}。",
  "doctor.check.stale_archive.remediation":
    "运行 `fabric doctor --fix-knowledge`将 stale entries 移动到 `.fabric/.archive/<type>/`。",
  "doctor.check.pending_overdue.name": "Knowledge pending overdue",
  "doctor.check.pending_overdue.ok":
    "没有 pending knowledge entries 超过 14-day review threshold。",
  "doctor.check.pending_overdue.message.singular":
    "{count} 个 pending knowledge entry 已等待 review 超过 {thresholdDays} 天。首个：{detail}。",
  "doctor.check.pending_overdue.message.plural":
    "{count} 个 pending knowledge entries 已等待 review 超过 {thresholdDays} 天。首个：{detail}。",
  "doctor.check.pending_overdue.remediation":
    "通过 fabric-review Skill（`/fabric-review`）审阅 pending entries，并执行 approve / reject / defer / modify。",
  "doctor.check.stable_id_duplicate.name": "Knowledge stable_id duplicate",
  "doctor.check.stable_id_duplicate.ok":
    "team / personal trees 中没有 canonical knowledge files 共享 stable_id。",
  "doctor.check.stable_id_duplicate.message.singular":
    "{count} 个 stable_id 在 canonical knowledge files 中重复（path-decoupled identity invariant）。首个：{detail}。",
  "doctor.check.stable_id_duplicate.message.plural":
    "{count} 个 stable_ids 在 canonical knowledge files 中重复（path-decoupled identity invariant）。首个：{detail}。",
  // v2.0.0-rc.33 W3-2 (T6 #34): 同 stable_id_collision — 走 fabric-review modify 让 allocator 分配新 id, 不让用户手算。
  "doctor.check.stable_id_duplicate.remediation":
    "调 `/fabric-review modify <message 中列出的 duplicate id 之一>`, 由 canonical id allocator 分配新的 `<prefix>-<type>-<counter>--<slug>.md` (会同步重命名文件 + 更新 frontmatter + 修正 counters)。",
  "doctor.check.layer_mismatch.name": "Knowledge layer mismatch",
  "doctor.check.layer_mismatch.ok":
    "所有 canonical knowledge files 都位于 stable_id prefix 声明的 layer 下。",
  "doctor.check.layer_mismatch.message.singular":
    "{count} 个 canonical knowledge file 与其 stable_id layer prefix 的物理位置不一致（KT-* must live under team/, KP-* under personal/）。首个：{detail}。",
  "doctor.check.layer_mismatch.message.plural":
    "{count} 个 canonical knowledge files 与其 stable_id layer prefix 的物理位置不一致（KT-* must live under team/, KP-* under personal/）。首个：{detail}。",
  // v2.0.0-rc.33 W3-2 (T6 #35): 加 skill 入口 (`/fabric-review modify <id>`) 让用户知道怎么 invoke。
  "doctor.check.layer_mismatch.remediation":
    "将文件移动到正确的 layer root (KT-* → .fabric/knowledge/team/, KP-* → ~/.fabric/knowledge/personal/), 或调 `/fabric-review modify <message 中列出的 id>` 切换其 layer (会相应重命名 stable_id prefix)。",
  "doctor.check.index_drift.name": "Knowledge index drift",
  "doctor.check.index_drift.ok":
    "agents.meta.json counters envelope 对每个 (layer, type) pair 都大于或等于现有 canonical counter 最大值。",
  "doctor.check.index_drift.message.singular":
    "{count} 个 (layer, type) counter slot 已低于观测到的 canonical maximum（next allocate would collide）。首个：{detail}。",
  "doctor.check.index_drift.message.plural":
    "{count} 个 (layer, type) counter slots 已低于观测到的 canonical maximum（next allocate would collide）。首个：{detail}。",
  "doctor.check.index_drift.remediation":
    "运行 `fabric doctor --fix-knowledge`将 agents.meta.json counters 提升到 max_observed + 1。",
  "doctor.check.underseeded.name": "Knowledge underseeded",
  "doctor.check.underseeded.ok":
    "知识库已有 {count} 个 canonical entries（>= {threshold}）。",
  "doctor.check.underseeded.message.singular":
    "知识库仅有 {count} 个 canonical entry（< {threshold} threshold）。plan_context 检索面低于可用下限。",
  "doctor.check.underseeded.message.plural":
    "知识库仅有 {count} 个 canonical entries（< {threshold} threshold）。plan_context 检索面低于可用下限。",
  "doctor.check.underseeded.remediation":
    "运行 fabric-import Skill（`/fabric-import`）从 git history 与现有文档回填 knowledge。",
  "doctor.check.narrow_no_paths.name": "Knowledge narrow without paths",
  "doctor.check.narrow_no_paths.ok":
    "没有 narrow-scope canonical entries 的 relevance_paths array 为空。",
  "doctor.check.narrow_no_paths.message.singular":
    "{count} 个 narrow-scope canonical entry 的 relevance_paths array 为空（silent recall risk — narrow without anchors can never match a target path）。首个：{detail}。",
  "doctor.check.narrow_no_paths.message.plural":
    "{count} 个 narrow-scope canonical entries 的 relevance_paths array 为空（silent recall risk — narrow without anchors can never match a target path）。首个：{detail}。",
  "doctor.check.narrow_no_paths.remediation":
    "为 relevance_paths 添加 path anchors，或将 entry 的 relevance_scope 放宽到 broad。",
  "doctor.check.relevance_paths_dangling.name": "Knowledge relevance_paths dangling",
  "doctor.check.relevance_paths_dangling.ok":
    "所有 relevance_paths globs 都能在 workspace root 下解析到至少 1 个文件。",
  "doctor.check.relevance_paths_dangling.message.singular":
    "{count} 个 relevance_paths glob 在当前 workspace 中解析到 0 个文件。首个：{detail}。",
  "doctor.check.relevance_paths_dangling.message.plural":
    "{count} 个 relevance_paths globs 在当前 workspace 中解析到 0 个文件。首个：{detail}。",
  "doctor.check.relevance_paths_dangling.remediation":
    "更新 entry 的 relevance_paths，移除不再匹配任何文件的 globs，或使用 `fab_review.modify` 重写 anchor set。",
  "doctor.check.relevance_paths_drift.name": "Knowledge relevance_paths drift",
  "doctor.check.relevance_paths_drift.ok.skipped":
    "已跳过（git history unavailable；无法评估 {windowDays}d drift window）。",
  "doctor.check.relevance_paths_drift.ok.fresh":
    "所有 narrow-scope canonical entries 都至少有 1 个 relevance_path 在最近 {windowDays}d 内被触碰。",
  "doctor.check.relevance_paths_drift.message.singular":
    "{count} 个 narrow-scope canonical entry 的 relevance_paths globs 没有匹配到最近 {windowDays}d git history 中触碰过的文件。首个：{detail}。",
  "doctor.check.relevance_paths_drift.message.plural":
    "{count} 个 narrow-scope canonical entries 的 relevance_paths globs 没有匹配到最近 {windowDays}d git history 中触碰过的文件。首个：{detail}。",
  "doctor.check.relevance_paths_drift.remediation":
    "审阅该 entry 是否仍然相关 — 使用 `fab_review.modify` 刷新 anchors，或使用 `fab_review.reject` 归档。",
  "doctor.check.personal_layer_path_misclassify.name": "Personal-layer path misclassify",
  "doctor.check.personal_layer_path_misclassify.ok":
    "没有 personal-layer entries 的 relevance_paths 解析到当前项目内的文件。",
  "doctor.check.personal_layer_path_misclassify.message.singular":
    "{count} 个 personal-layer entry 的 relevance_paths 命中当前项目内的文件（personal 层应保持项目无关）。首个：{detail}。",
  "doctor.check.personal_layer_path_misclassify.message.plural":
    "{count} 个 personal-layer entries 的 relevance_paths 命中当前项目内的文件（personal 层应保持项目无关）。首个：{detail}。",
  "doctor.check.personal_layer_path_misclassify.remediation":
    "用 `fab_review.modify` 把 layer 翻成 team，或重写 relevance_paths 让 anchors 保持项目无关（删掉项目特定 globs）。",
  "doctor.check.suspicious_kb.name": "Suspicious KB injection",
  "doctor.check.suspicious_kb.ok":
    "所有 canonical knowledge body 均未命中已知 prompt-injection 模式。",
  "doctor.check.suspicious_kb.message.singular":
    "{count} 个 canonical entry body 含命中 prompt-injection 模式的 token（多半是 NEW-31 之前归档的 legacy 条目）。首个：{detail}。",
  "doctor.check.suspicious_kb.message.plural":
    "{count} 个 canonical entry bodies 含命中 prompt-injection 模式的 token（多半是 NEW-31 之前归档的 legacy 条目）。首个：{detail}。",
  "doctor.check.suspicious_kb.remediation":
    "审阅被标记的条目 — 用 `fab_review.modify` 擦掉 body 中的 injection token，或 `fab_review.reject` 归档不该 canonicalize 的条目。",
  "doctor.check.narrow_too_few.name": "Knowledge narrow too few",
  "doctor.check.narrow_too_few.ok":
    "Narrow-with-paths ratio {ratioPct}%（{narrowCount}/{totalCount}）；{teleNote}。",
  "doctor.check.narrow_too_few.message.telemetry_skipped":
    "telemetry skipped（no edit-counter fires in window）",
  "doctor.check.narrow_too_few.message.telemetry_window":
    "silence rate {silencePct}% over {windowDays}d",
  "doctor.check.narrow_too_few.message.structural":
    "narrow-with-paths share {ratioPct}%（{narrowCount}/{totalCount}）below {thresholdPct}% threshold",
  "doctor.check.narrow_too_few.message.telemetry":
    "narrow-hook silence rate {silencePct}%（{silenceFires}/{totalFires}）over {windowDays}d above {thresholdPct}% threshold",
  "doctor.check.narrow_too_few.message.summary":
    "Narrow-scope KB coverage 低于可用下限：{parts}。",
  "doctor.check.narrow_too_few.remediation":
    "运行 fabric-import Skill（`/fabric-import`）针对当前 codebase 重新播种 narrow anchors。",
  "doctor.check.session_hints_stale.name": "Knowledge session-hints stale",
  "doctor.check.session_hints_stale.ok":
    ".fabric/.cache/ 下没有超过 {days} 天的 session-hints cache files。",
  "doctor.check.session_hints_stale.message.singular":
    ".fabric/.cache/ 下有 {count} 个 session-hints cache file 超过 {days} 天。首个：{detail}。",
  "doctor.check.session_hints_stale.message.plural":
    ".fabric/.cache/ 下有 {count} 个 session-hints cache files 超过 {days} 天。首个：{detail}。",
  "doctor.check.session_hints_stale.remediation":
    "运行 `fabric doctor --fix-knowledge` 删除过期的 session-hints cache files。",
  "doctor.check.stale_serve_lock.name": "Serve lock",
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
  "doctor.check.relevance_fields_missing.name": "Knowledge relevance fields missing",
  "doctor.check.relevance_fields_missing.ok":
    "所有 pending entries 都声明了 relevance_scope 和 relevance_paths。",
  "doctor.check.relevance_fields_missing.message.singular":
    "{count} 个 pending entry 的 frontmatter 缺少 relevance_scope 和/或 relevance_paths。首个：{detail}。",
  "doctor.check.relevance_fields_missing.message.plural":
    "{count} 个 pending entries 的 frontmatter 缺少 relevance_scope 和/或 relevance_paths。首个：{detail}。",
  "doctor.check.relevance_fields_missing.remediation":
    "运行 `fabric doctor --fix-knowledge` 回填 schema defaults（relevance_scope: broad，relevance_paths: []）。",
  // rc.31 BUG-M3/NEW-4: hooks_wired observability.
  "doctor.check.hooks_wired.name": "Claude Code hooks wired",
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
  "doctor.check.hooks_runtime.ok.skipped": "未发现已安装的 hook 文件（.claude/hooks/ / .codex/hooks/ / .cursor/hooks/ 都缺）；跳过 hooks_runtime 检查。",
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
    "已扫描 {count} 个 hook 副本，跨 client (.claude / .codex / .cursor) sha256 全部一致。",
  "doctor.check.hooks_content_drift.message":
    "{count} 个 hook basename 在 client 之间内容 drift；首例：{first_basename}（涉及 {first_clients}）。`fabric install` 复制同一模板到三 client，drift 通常来自手动编辑。",
  "doctor.check.hooks_content_drift.remediation":
    "运行 `fabric install` 把所有 client 的 hook 副本恢复到 canonical 模板。若你确实需要 client-specific hook 行为，建议改 lib/ 共享脚本或 templates/hooks/configs/ 配置而非直接编辑安装后的 .cjs。",
  // rc.31 BUG-G2/G5: promote-ledger invariant check.
  "doctor.check.promote_ledger_invariant.name": "Promote ledger invariant",
  "doctor.check.promote_ledger_invariant.ok":
    "knowledge_proposed={proposed} ≥ knowledge_promote_started={started} ≥ knowledge_promoted={promoted}，ledger 不变量持有。",
  "doctor.check.promote_ledger_invariant.message.proposed-lt-started":
    "knowledge_proposed={proposed} 小于 knowledge_promote_started={started}（ledger 不变量被破坏；部分 pending 在 approve 时未经过 fab_extract_knowledge → 缺少 propose 事件）。",
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
  "doctor.check.skill_md_yaml_invalid.name": "Skill markdown YAML",
  "doctor.check.skill_md_yaml_invalid.ok":
    "所有 .claude/.codex SKILL.md frontmatter values 都能按 strict YAML 解析。",
  "doctor.check.skill_md_yaml_invalid.message.singular":
    "{count} 个 SKILL.md frontmatter value 包含未加引号的 ': '，strict YAML parsers 会拒绝（Claude Code tolerates it；Codex CLI drops the skill at load）。首个：{detail}。",
  "doctor.check.skill_md_yaml_invalid.message.plural":
    "{count} 个 SKILL.md frontmatter values 包含未加引号的 ': '，strict YAML parsers 会拒绝（Claude Code tolerates it；Codex CLI drops the skill at load）。首个：{detail}。",
  "doctor.check.skill_md_yaml_invalid.remediation":
    "使用双引号包裹该 value（`description: \"…\"`），或将内部的 `key: value` token 改写为 `key=value`。",
  "doctor.check.onboard_coverage.name": "Onboard coverage",
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

  "cli.hooks.description": "管理 Fabric Git 钩子模板。",
  "cli.hooks.install.description": "安装 Fabric Husky pre-commit 钩子模板。",
  "cli.hooks.install.args.target.description": "目标项目路径，默认为当前工作目录。",
  "cli.hooks.errors.package-json-required": "安装 hooks 需要 package.json：{path}",
  "cli.hooks.install.hook-skipped": "{path} 中已存在 Fabric hook，已跳过。",
  "cli.hooks.install.hook-appended": "已向现有 {path} 追加 Fabric hook",
  "cli.hooks.install.hook-created": "已创建 {path}",
  "cli.hooks.install.prepare-left": "保留 {path} 中原有的 prepare 脚本不变",
  "cli.hooks.install.prepare-added": "已向 {path} 添加 prepare 脚本",

  "cli.human-lint.description": "验证锁定的人工编辑区块。",
  "cli.human-lint.args.target.description": "目标项目路径，默认为当前工作目录。",
  "cli.human-lint.drift-detected": "检测到 human-lock 内容漂移。请回退编辑，或在提交前更新已批准的哈希。",
  "cli.human-lint.table.location": "位置",
  "cli.human-lint.table.expected": "预期",
  "cli.human-lint.table.got": "实际",

  "cli.install.description":
    "在目标项目中安装 Fabric（脚手架 .fabric/、bootstrap 模板、MCP 客户端配置、git hooks）。\n" +
    "\n" +
    "示例：\n" +
    "  fabric install                  在当前项目中以交互模式安装\n" +
    "  fabric install --yes            接受默认值，跳过 TTY 向导\n" +
    "  fabric install --dry-run        仅预览安装计划，不写入文件",
  "cli.install.args.target.description":
    "目标项目路径。默认依次使用 --target、EXTERNAL_FIXTURE_PATH、当前目录。",
  "cli.install.args.debug.description": "将目标解析细节输出到 stderr。",
  "cli.install.args.yes.description": "接受当前安装计划并跳过 TTY 向导直接执行",
  "cli.install.args.dry-run.description": "仅输出安装计划，不写文件也不执行后续阶段",
  // rc.35 TASK-08 (P0-5/6): --force-skills-only。
  "cli.install.args.force-skills-only.description":
    "跳过 bootstrap / MCP / hooks / settings,只重新刷新 fabric Skill 模板 (.claude/.codex/.cursor/skills/*)。",
  "cli.install.force-skills-only.banner": "只刷新 fabric Skill 模板",
  "cli.install.force-skills-only.uninitialised.message":
    "fabric install --force-skills-only: 项目未初始化(找不到 .fabric/agents.meta.json)。",
  "cli.install.force-skills-only.uninitialised.hint":
    "请先运行 `fabric install`(不带 --force-skills-only)铺设基础 scaffold;之后再用 --force-skills-only 做后续 Skill 刷新。",
  "cli.install.force-skills-only.summary": "Skill 刷新完成 — 写入: {written}, 跳过: {skipped}, 错误: {errors}",
  // v2.0.0-rc.37 NEW-26: --force-hooks-only mirror of --force-skills-only。
  "cli.install.args.force-hooks-only.description":
    "跳过 bootstrap / MCP / skills / settings,只重新刷新 fabric hook scripts + per-client hook config 合并 (.claude/.codex/.cursor/hooks/*)。",
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
  "cli.install.steps.bootstrap-cursor": "已更新 .cursor/rules/fabric-bootstrap.mdc",
  "cli.install.stages.mcp": "正在配置 MCP 客户端...",
  "cli.install.stages.hooks": "正在安装 git hooks...",
  "cli.install.stages.skipped": "已跳过",
  "cli.install.stages.completed": "已完成",
  "cli.install.stages.failed": "失败",
  "cli.install.stages.summary.ran": "已执行",
  "cli.install.stages.summary.skipped": "已跳过",
  "cli.install.stages.summary.failed": "失败",
  "cli.install.next-step": "{label} {message}",
  "cli.install.reason-message": "{label} {message}",
  "cli.install.language_preference_hint":
    "Fabric 语言偏好：{value}。如需调整，请编辑 .fabric/fabric-config.json 中的 fabric_language 字段（可选值：match-existing | zh-CN | en | zh-CN-hybrid）。",
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
  "cli.install.wizard.mcp-install": "MCP 服务端安装范围（global/local）[{defaultValue}]",
  "cli.install.wizard.execute.confirm": "现在执行该安装计划？[Y/n]",
  "cli.install.wizard.outro": "安装计划已确认，开始执行 Fabric install...",
  "cli.install.wizard.invalid-yes-no": "请输入 yes 或 no。",
  "cli.install.wizard.invalid-select": "无效输入。可选值：{options}。",
  "cli.install.wizard.cancelled": "Fabric 安装已在执行前取消。",
  "cli.install.capabilities.title": "客户端能力摘要",
  // v2.0.0-rc.37 NEW-22: post-install 重启提示。MCP server 在 client 启动
  // 时 spawn, 已运行的 Claude Code / Cursor / Codex session 不会自动加载
  // 新 mcp config — 必须重启才能拿到 Fabric tools。
  "cli.install.restart-banner":
    "重启提示: 已运行的 Claude Code / Cursor / Codex CLI session 需重启才能加载新 MCP server 配置;新会话会自动使用 Fabric tools。",
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
  "cli.install.next-step.message": "运行 fabric hooks install 以添加第 4 天的 pre-commit 流水线。",
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
  "cli.install.diff.state.missing": "缺失",
  "cli.install.diff.state.present-canonical": "规范",
  "cli.install.diff.state.drifted": "漂移",
  "cli.install.diff.state.user-modified": "用户修改",

  "cli.uninstall.description":
    "从目标项目中卸载 Fabric。.fabric/knowledge/ 始终保留；~/.fabric/knowledge/ 永不受影响。\n" +
    "\n" +
    "示例：\n" +
    "  fabric uninstall                在当前项目中以交互模式卸载\n" +
    "  fabric uninstall --yes          接受默认值，跳过 TTY 向导\n" +
    "  fabric uninstall --dry-run      仅预览卸载计划，不删除文件",
  "cli.uninstall.args.target.description":
    "目标项目路径。默认依次使用 --target、EXTERNAL_FIXTURE_PATH、当前目录。",
  "cli.uninstall.args.debug.description": "将目标解析细节输出到 stderr。",
  "cli.uninstall.args.yes.description": "接受当前卸载计划并跳过 TTY 向导直接执行。",
  "cli.uninstall.args.dry-run.description": "仅输出卸载计划，不删除文件也不执行后续阶段。",
  "cli.uninstall.plan.title": "Fabric 卸载计划",
  "cli.uninstall.plan.target": "目标：{target}",
  "cli.uninstall.plan.actions":
    "计划：scaffold={scaffold} bootstrap={bootstrap} mcp={mcp}",
  "cli.uninstall.plan.detected": "检测到的客户端：{clients}",
  "cli.uninstall.plan.preserves": "保留项：",
  "cli.uninstall.plan.preserves.knowledge": "团队知识树（始终保留）",
  "cli.uninstall.plan.preserves.personal": "个人根目录，永不触碰",
  "cli.uninstall.plan.preview-title": "Fabric 卸载 dry run",
  "cli.uninstall.plan.preview-result":
    "scaffold={scaffold} bootstrap={bootstrap} mcp={mcp}",
  "cli.uninstall.plan.scaffold-entries.title": "Scaffold 待清理项：",
  "cli.uninstall.stages.scaffold": "正在清理 scaffold 产物...",
  "cli.uninstall.stages.bootstrap": "正在移除 bootstrap（Skills + hooks）...",
  "cli.uninstall.stages.mcp": "正在反注册 MCP 客户端...",
  "cli.uninstall.stages.completed": "已完成",
  "cli.uninstall.stages.completed-with-errors": "完成但有错误",
  "cli.uninstall.stages.failed": "失败",
  "cli.uninstall.summary.title": "卸载摘要",
  "cli.uninstall.summary.body": "removed={removed} skipped={skipped} errors={errors}",
  "cli.uninstall.wizard.intro": "卸载 Fabric",
  "cli.uninstall.wizard.overview.title": "卸载概览",
  "cli.uninstall.wizard.overview.body":
    "目标：{target}\n这个向导只负责调整卸载计划；真正执行仍然走现有的 Fabric uninstall 阶段。\n.fabric/knowledge/ 始终保留；~/.fabric/knowledge/ 永不受影响。",
  "cli.uninstall.wizard.step.target": "确认目标",
  "cli.uninstall.wizard.step.plan": "配置卸载计划",
  "cli.uninstall.wizard.step.review": "复核最终计划",
  "cli.uninstall.wizard.target.confirm": "确认从 {target} 卸载 Fabric？[Y/n]",
  "cli.uninstall.wizard.stage.scaffold": "是否清理 scaffold 产物？[{defaultValue}]",
  "cli.uninstall.wizard.stage.bootstrap": "是否移除 bootstrap（Skills + hooks）？[{defaultValue}]",
  "cli.uninstall.wizard.stage.mcp": "是否反注册 MCP 客户端？[{defaultValue}]",
  "cli.uninstall.wizard.execute.confirm": "现在执行该卸载计划？[Y/n]",
  "cli.uninstall.wizard.outro": "卸载计划已确认，开始执行 Fabric uninstall...",
  "cli.uninstall.wizard.cancelled": "Fabric 卸载已在执行前取消。",
  "cli.uninstall.confirm.proceed": "确认从 {target} 卸载 Fabric？[y/N]",
  "cli.uninstall.errors.target-not-directory": "目标必须是已存在的目录：{path}",

  "cli.ledger-append.description": "向 Fabric 意图日志追加一条记录。",
  "cli.ledger-append.args.target.description": "目标项目路径，默认为当前工作目录。",
  "cli.ledger-append.args.staged.description": "从暂存变更推导记录（用于 pre-commit 阶段）。",
  "cli.ledger-append.requires-staged": "pre-commit 场景下必须传入 --staged",
  "cli.ledger-append.intent.auto": "自动：{head}{suffix}",
  "cli.ledger-append.intent.auto-more": " 等 {count} 项",

  "cli.pre-commit.description":
    "复合 pre-commit 钩子：在单个 Node 进程中依次执行 sync-meta --check-only、human-lint、ledger-append --staged。",
  "cli.pre-commit.args.target.description": "项目根目录，默认取当前目录或 EXTERNAL_FIXTURE_PATH。",
  "cli.pre-commit.run-failed": "fabric pre-commit：{name} 失败 - {message}",

  "cli.scan.description": "扫描项目以检测 Fabric 引导候选模块。",
  "cli.scan.args.target.description":
    "目标绝对路径。默认依次使用 --target、EXTERNAL_FIXTURE_PATH、当前目录。",
  "cli.scan.args.debug.description": "以格式化输出打印检测证据。",
  "cli.scan.args.json.description": "以 JSON 格式输出诊断报告。",
  "cli.scan.error.missing-forensic":
    "未找到 forensic.json（路径 {path}）；请先运行 `fabric install` 生成项目快照。",
  "cli.scan.summary.created": "已写入 {count} 条知识条目至 .fabric/knowledge/。",
  "cli.scan.summary.skipped": "无差异；{count} 条已存在的条目保持不变。",
  "cli.scan.report.title": "Fabric 扫描报告",
  "cli.scan.report.target": "目标",
  "cli.scan.report.framework": "框架",
  "cli.scan.report.evidence": "证据",
  "cli.scan.report.readme-quality": "README 质量",
  "cli.scan.report.contributing": "CONTRIBUTING.md",
  "cli.scan.report.files-counted": "文件数",
  "cli.scan.report.ignored-entries": "忽略项",
  "cli.scan.report.existing-fabric": "现有 Fabric 文件",
  "cli.scan.report.recommendations": "建议：",
  "cli.scan.readme-quality.ok": "良好",
  "cli.scan.readme-quality.stub": "草稿",
  "cli.scan.recommendation.init": "L0：运行 fabric install，在 .fabric/AGENTS.md 生成 Fabric 引导规范内容。",
  "cli.scan.recommendation.readme": "L0：先补充 README.md，再把项目事实整理到 Fabric 参考文件中。",
  "cli.scan.recommendation.contributing": "L0：添加 CONTRIBUTING.md，或在 bootstrap 中留下贡献流程的 TODO 说明。",
  "cli.scan.recommendation.unknown-framework": "L1：当前未检测到框架标记，需要手动补充技术栈说明。",
  "cli.scan.recommendation.framework-dirs": "L1：检查 {framework} 目录，后续为其补充对应作用域的 Fabric 规则文件。",

  // v2.0.0-rc.37 Wave A2 Part 2: cli.serve.* + FABRIC_AUTH_TOKEN keys removed
  // alongside `fabric serve` quarantine to packages/server-http-experimental/
  // per [[fabric-serve-quarantine-not-delete]]. Restore from git history when
  // the web UI surface is re-enabled.

  // v2.0.0-rc.29 TASK-008 (BUG-L2): onboard-coverage 国际化键。
  "cli.onboard-coverage.description":
    "汇总当前工作区的 S5 onboard-slot 覆盖度。fabric-archive Skill 首跑阶段用它判断哪些项目语调槽位尚未被认领。",
  "cli.onboard-coverage.args.json.description":
    "输出机器可读的 JSON 到 stdout（替代人类可读的表格）。",
  "cli.onboard-coverage.args.target.description":
    "覆盖项目根目录（默认为当前工作目录）。",

  "cli.update.description": "刷新 MCP 主机配置和 git hooks，不重新创建 Fabric 文件。",
  "cli.update.args.target.description":
    "目标项目路径。默认依次使用 --target、EXTERNAL_FIXTURE_PATH、当前目录。",
  "cli.update.args.no-mcp.description": "跳过重新配置 MCP 客户端",
  "cli.update.args.no-hooks.description": "跳过重新安装 git hooks",

  "cli.sync-meta.description": "从内部规则文件同步 Fabric 元数据。",
  "cli.sync-meta.args.target.description": "目标项目路径，默认为当前工作目录。",
  "cli.sync-meta.args.check-only.description": "如果 .fabric/agents.meta.json 已过期，则以代码 1 退出。",
  "cli.sync-meta.drift-detected": "检测到 Fabric 元数据漂移。请运行 fabric sync-meta 进行更新。",
  "cli.sync-meta.updated": "{label} {path}",

  "dashboard.app.nav.aria-label": "仪表盘视图导航",
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
};
