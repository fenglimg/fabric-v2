import { describe, expect, it } from "vitest";

import { enMessages } from "./locales/en.js";
import { zhCNMessages } from "./locales/zh-CN.js";

// ---------------------------------------------------------------------------
// i18n census invariant — locale key parity (fallback-purge Wave 0, G-INVARIANT)
//
// The translator resolves `active[key] ?? en[key] ?? key`, so a missing key is
// SILENT: a key present only in en degrades zh-CN users to English; a key
// present only in zh-CN shows en users the raw key literal. Neither path
// errors, so a literal grep (or a forgotten key during a copy-paste) rots the
// UI without any test catching it. This census asserts the two locale tables
// are key-for-key identical at the data level — the deterministic gate that
// replaces ad-hoc grep parity checks.
// ---------------------------------------------------------------------------

describe("i18n locale parity census", () => {
  const enKeys = Object.keys(enMessages).sort();
  const zhKeys = Object.keys(zhCNMessages).sort();

  it("en and zh-CN expose an identical key set (no silent fallback / raw-key leak)", () => {
    const enOnly = enKeys.filter((k) => !(k in zhCNMessages));
    const zhOnly = zhKeys.filter((k) => !(k in enMessages));

    // Named assertions so a drift report points at the offending keys directly.
    expect({ missingInZh: enOnly, missingInEn: zhOnly }).toEqual({
      missingInZh: [],
      missingInEn: [],
    });
  });

  it("every message value is a non-empty string in both locales", () => {
    const emptyEn = enKeys.filter((k) => typeof enMessages[k] !== "string" || enMessages[k].length === 0);
    const emptyZh = zhKeys.filter((k) => typeof zhCNMessages[k] !== "string" || zhCNMessages[k].length === 0);

    expect({ emptyEn, emptyZh }).toEqual({ emptyEn: [], emptyZh: [] });
  });

  // -------------------------------------------------------------------------
  // W4 B5 — dead-key ratchet.
  //
  // 403 of 1265 keys (31.9%) were provably unreferenced: the whole v1.8
  // `dashboard.*` subsystem (201), the retired `--force-skills-only` /
  // `--force-hooks-only` install flags, and the `agents_meta` check that went
  // with the retired co-location index. Nothing failed while they sat there —
  // an unused key costs nothing at runtime, which is exactly why they piled up
  // for two minor lines. This ratchet is the only thing that notices.
  //
  // To change the count you must RE-RUN THE CENSUS, not just edit the number.
  // The census is not a checked-in script on purpose (the last one,
  // scripts/i18n-audit.mjs, rotted into a "not committed" one-off that duplicated
  // the parity test above): scan every file under the repo — every suffix,
  // including .cjs hook templates and installed .claude/.codex copies — for each
  // key, treating a key as ALIVE when a file `includes()` it literally OR it
  // matches a `${...}`-wildcarded template literal found in the source. Both
  // halves are required: `doctor.check.<code>.message.${singular}` and
  // `cli.config.fields.${key}.label` are built dynamically and a literal-only
  // scan reports 562 false deaths.
  // -------------------------------------------------------------------------
  // 2026-08-11 (W5 轴F): 862 → 865. Net +3 = four added (`cli.store.{backfill,
  // rescope,promote,reroot}.description`, routing the store migration commands'
  // hardcoded English through t() like every other store command) minus one
  // removed (`doctor.conflict.deep_no_judge`, orphaned when the empty
  // `audit conflicts --deep` flag was deleted). A fifth, `cli.store.link
  // .description`, was added and then removed in the same pass when the whole
  // `store link` command turned out to be dead on arrival and was deleted.
  // Census re-run per the note above: 10,011 files, 454 template patterns,
  // 0 provably dead.
  //
  // Re-running it caught a bug worth repeating here, because it is the natural
  // way to write the wildcard half and it is wrong: escape the key THEN
  // substitute `${...}` and you get `\[A-Za-z0-9_.-]+` — an escaped literal
  // bracket matching nothing — which reported 100+ live keys as dead. Split on
  // `${...}` first, escape each literal segment, then join with the wildcard.
  // 2026-08-12(合并 feat/sync-readme-version): 865 → 867。净 +2 = `cli.audit
  // .why.maturity-draft` 与其 `.hint`,G3「draft 的 guideline/model 不进
  // SessionStart 常驻层」给 `fabric audit why-not-surfaced` 补的那条归因分支;
  // 两个 key 的消费者都是 packages/cli/src/commands/audit.ts。
  // 按上面的规矩重跑了 census:1901 文件、175 个 template pattern、0 provably dead。
  //
  // ⚠️ 文件数比上一轮的 10,011 少了八千,不是漏扫 —— 差额是 W5 删掉的 `tmp/`
  // 下那 10 个 vendor 克隆(对照阅读用的别家仓库)。拿别的项目的源码给我们的
  // key 判「活」本来就是假阳性,少扫它们让判据更严而不是更松。
  // 2026-08-17 (2.5.1): 867 → 868。净 +1 = `cli.install.rollback.feedback.none`,
  // 安装回滚时「一条都没回滚」的独立文案 —— 旧文案在回滚栈为空时照样宣称项目
  // 未被改动,而那正是 `.fabric/` 已被前面阶段建好的那种失败。消费者是
  // packages/cli/src/install/pipeline/pipeline.ts 的 rollback()。
  // 按上面的规矩重跑了 census:1926 文件、205 个 template pattern、0 provably dead。
  // 2026-08-17 (知识叙述装置): 868 → 874。净 +6 = `doctor.check
  // .knowledge_summary_session_voice.{name,ok,message.singular,message.plural,
  // remediation,scan_error}`,给「summary 写成会话纪要」这条新 doctor lint 的整套
  // 文案。summary 是 fab_recall 唯一投递上线的字段,写成纪要等于这条知识不可发现;
  // 消费者是 packages/server/src/services/doctor/doctor-summary-voice.ts。
  // 按上面的规矩重跑了 census:1940 文件、59 个 template pattern、0 provably dead。
  //
  // ⚠️ 这轮踩到两个会让 census 静默失真的坑,都值得记下来:
  // ① **嵌套 worktree 必须排除。** `.claude/worktrees/<name>/` 下是整份仓库副本,
  //    含第二份 locale 表 —— 不排除它,每个 key 都被自己的副本判「活」,census 恒
  //    输出 0 dead 而毫无鉴别力。第一遍扫 3002 文件得 0 dead 就是这个假阴性。
  // ② **别按反引号切模板字面量。** 真实调用点是嵌套的
  //    (`` `  - ${t(`cli.sync.state.${s}`)}` ``),从外层反引号扫到下一个反引号会
  //    在内层处截断,拿到的字面段里根本没有 key 路径,于是 `cli.sync.state.*` 与
  //    `cli.uninstall.plan.action.*` 共 9 个活 key 被报成 dead。改为直接匹配
  //    「点分路径 + `${...}`」这个形状,不依赖定界符配对。
  // template pattern 计数从 205 掉到 59 是这次换匹配口径的结果(去重口径变了),
  // 不是模板变少;判据看的是 0 dead,该数字只用于说明扫描口径。
  // 2026-08-17 (why-not-surfaced retire 分支): 874 → 877。净 +3 = `cli.audit
  // .why.deprecated{,.superseded,.hint}`,给 `fabric audit why-not-surfaced`
  // 补的第四条归因分支。此前该命令对已 retire(`deprecated: true`)的条目一律
  // 回答「应当正在浮现」—— 召回侧 cross-store-recall 明明把它们全过滤掉了,
  // 而 why-not-surfaced.ts 全文 0 处引用 deprecated。两条消息(带/不带
  // superseded_by)而不是拼串,是为了避免渲染出悬空的 ", superseded_by: "。
  // 消费者是 packages/cli/src/commands/audit.ts。
  // 按上面的规矩重跑了 census:3027 文件、141 个 template pattern、0 provably dead。
  //
  // ⚠️ 这轮给 census 补了**对照组**:注入 3 个绝无引用的假 key,断言它们全被判死。
  // 「0 dead」单独看是无法证伪的 —— 一个恒判活的扫描器给出的也是 0 dead(上一轮
  // 的 worktree 假阴性正是这个形状)。canary 判死 3/3 才说明这次扫描有鉴别力。
  // 2026-08-17 (console 项目注册表): 877 → 883。净 +6 = `cli.info.projects{
  // .description,.args.json.description,.empty,.title,.stale,.stale-note}`,
  // 给新增的 `fabric info projects` 子命令(机器级项目注册表的读出口)配的文案。
  // 消费者是 packages/cli/src/commands/info.ts 的 projectsCommand /
  // runProjectsList。`.empty` 与 `.stale-note` 是产品化要求的产物:空列表与失效
  // 条目都必须讲清原因和下一步,不能只给一片空白。
  // 按上面的规矩重跑了 census:1724 文件、44 个 template pattern、0 provably dead,
  // canary 3/3 判死。
  //
  // ⚠️ 这轮 canary 又抓到一个自捕获假阴性:一次性 census 脚本把 canary key 写在
  // 自己文件里,而脚本自身也在扫描范围内 → 每个 canary 都「找到了自己」,首跑
  // 0/3 判死。形状与上一轮的 worktree 假阴性完全相同(扫描器把自己的副本当作
  // 引用)。修法是把脚本自身排除出 sources。**任何把 canary 字面量写进被扫描
  // 目录的做法都会复发这个坑。**
  // 2026-08-17 (console 骨架 Step 1): 883 → 882。净 −1 = `cli.preview.arg.host`,
  // 随 `fabric preview --host` flag 一起删除。该 flag 让 `--host 0.0.0.0` 把只读
  // 预览服务暴露到局域网 —— 而同一个文件的两处注释都声明「binds 127.0.0.1 ONLY
  // (never 0.0.0.0)」。控制台正要给这个服务加写通道,那时同一个 flag 会变成
  // 「局域网任意机器可改本机 Fabric 配置」。绑定地址改为 startPreviewServer 内的
  // ALLOWED_HOSTS 白名单(非法值抛错,不静默降级),CLI 侧不再有任何改绑入口。
  // 按上面的规矩重跑了 census:1999 文件、59 个 template pattern、0 provably dead,
  // canary 3/3 判死。
  //
  // ⚠️ 这轮 canary 连抓两个盲区,都是「扫描器恒判活」的形状:
  // ① **模板模式必须锚定点分前缀。** 从 `${` 往前取字面段会把通用插值
  //    (`${a}.${b}`)也收进来,它编译成 `^[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+$`
  //    —— 匹配一切点分字符串,于是任何输入都是 0 dead(canary 首跑 0/3)。
  // ② **贪婪左到右扫嵌套模板会吞掉内层 key。** 对
  //    `` `${paint.muted(t(`cli.sync.state.${s}`))}` ``,外层 `${...}` 一路吃到
  //    内层的 `}`,内层 key 模板根本不会被发射 → `cli.sync.state.*` /
  //    `cli.uninstall.plan.action.*` / `cli.config.source.*` 共 14 个活 key 被
  //    报成 dead。改为锚定「点分字面前缀 + `${`」的形状后,外层形态不可匹配,
  //    内层自然被单独找到。这与注释 ② 记的是同一族坑的两个变体。
  // 另:census 脚本这轮写在 /tmp 而非仓库内 —— 上一轮的自捕获假阴性(脚本把
  // canary 字面量写在自己文件里、自己又在扫描范围内)靠物理隔离根除,而不是靠
  // 记得维护一条排除规则。
  // 2026-08-17 (console 配置视图 S3): 882 → 883。净 +1 = `cli.config.source.env`。
  // 配置的 env 层此前被面板整体略过,理由写在 config.ts:「不是每个旋钮都有 env
  // reader,宣称有就是撒谎的展示」—— 判断对,但选了保守的错一半:对确实有 reader
  // 的 4 个键(default_layer_filter / fusion / nudge_mode /
  // underseed_node_threshold),面板把 env 生效的情况显示成「全机器」,也就是显示了
  // 一个不生效的值。新键由既有模板 `t(\`cli.config.source.${source}\`)`
  // (config.ts:887)消费,不需要新接线。
  // 本轮**没有重跑 dead-key census**,理由:死键由**删除**产生(某 key 的最后一个
  // 引用消失),本轮只增不删,已有 882 个键的存活判定不会因为多一个键而改变。若哪
  // 轮同时含删除,census 必须重跑 —— 这条豁免只对纯增量成立。
  // 2026-08-17 (console 配置视图 S4): 883 → 906。净 +23 = `cli.console.config.*`,
  // 配置页的页面 chrome 文案(分组标题 / scope 选择 / 保存与失败 / env 锁定说明 /
  // 远程嵌入的存在性描述)。经 `/api/config` 的 `strings` 字段下发,消费者是
  // src/console/config-view.ts#chromeStrings —— 那里的 key 列表就是这 23 条的
  // 权威清单。之所以不学 status.html 硬编码中文:那种写法在 `language: en` 的机器
  // 上会渲染成中英混排。同上一轮:纯增量,不重跑 census。
  // 2026-08-18 (全局配置管理页 S4): 906 → 920。净 +14 = 新增 20 条
  // `cli.console.config.{machine,projects,stores}.*`(机器视角三个区的区标题、
  // 项目行的四种状态说明、空态与其可执行指引、知识库区文案),减去 6 条:
  // `cli.console.config.scope.{label,project,defaults,unavailable}` 与
  // `store-missing` 随「改动作用于」下拉一起退役 —— 写入目标不再从 cwd 推断,
  // 而是由请求显式指定,那个下拉没有指代对象了。
  //
  // 本轮**含删除,按规矩重跑了 census**:2030 文件、55 个 template pattern、
  // 0 provably dead,canary 3/3 判死。
  //
  // ⚠️ canary 首跑 0/3,根因是上面注释 ① 那条坑的一个**新变体**,值得单记:
  // 收紧规则当时写成「从 `${` 往前取字面段」,仓库里一条临时文件名模板
  // `` `${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}` `` 的
  // 前缀是空串,却仍被收进模式集,编译成「任意三段点分串」——`cli.a.b` 形状的
  // key 全被它判活,于是 920 个键 0 dead 而 canary 也 0 dead。判据改为「静态
  // 前缀长度 ≥3 且含点」后,模式集 332 → 55,canary 立刻 3/3。
  // 教训与 ① ② 同族:**通配模式的宽度必须由 canary 量,不能靠读代码判断**——
  // 一个过宽的模式不会报错,只会让普查安静地永远返回 0。
  // 2026-08-19 (控制台产品化 W2): 920 → 945。净 +25,全部是新增:
  // 17 条 `cli.console.config.*`(搜索框与空结果、高级区的标题/说明/计数、已改标记、
  // 恢复默认及其回执、提醒频率预设的三档名与自定义态与成功/部分失败回执),
  // 2 条 `cli.config.fields.hint_dismiss_signals.{label,description}`
  //(新面板字段:永久关闭哪些提醒,原先只能手改 JSON),
  // 1 条 `cli.console.config.remote.how`(远程嵌入三项在这一页只读,那就得说去哪儿改),
  // 5 条 `cli.console.config.semantic.*`(语义检索的意图 vs 实际生效四态)。
  // 另有 4 条 `*.label` 改了**值**没改 key(archive_hint_hours / audit_mode /
  // nudge_mode / fusion 的文案改成陈述句语域)—— 值变更不进 census。
  // 纯增量,按上面的豁免不重跑 dead-key scan。
  // 2026-08-19 (控制台产品化 W3): 945 → 1010。净 +65,全部是新增:
  // 51 条 `cli.console.integrations.*`(集成页的页面 chrome:MCP 接入 / 规则引用 /
  // 物理文件三态与孤儿态 / 运行时行为 / 安装记录 / machine 作用域的空态,外加
  // `behaviors.shared` —— 同一个 key 被多个 hook 读取时,控件只画在第一个读它的
  // 行为下,其余行为出一条指向上面的引用 —— 以及 8 条 `repair.*`:两个动作各自的
  // 按钮与「它等同于哪条命令」,加上运行中/已结束两条状态),
  // 14 条 `cli.console.behavior.<hook>.{label,description}`(七个 hook 各一对 ——
  // 界面上的单位是「它在什么时候做什么」,不是它的文件名)。
  // 同样是纯增量,按上面的豁免不重跑 dead-key scan。
  // 2026-08-19 (控制台产品化 W4 全局项目发现): 1010 → 1011。净 +1:
  // 1 条 `cli.info.projects.version-unknown`。扫描回填进注册表的项目**没有版本可填**
  // —— 它是在磁盘上被找到的,不是被某次 install 记下来的。这里必须有一个键,是因为
  // 另外两个选项都在撒谎:填运行中的 CLI 版本会把五个老安装报成最新,填字面量
  // "unknown" 又会被拿去和运行版本比对然后报成「过期」。留空即"我们知道自己不知道"。
  // 纯增量,按上面的豁免不重跑 dead-key scan。
  // 2026-08-19 (控制台界面质感): 1011 → 1010。净 −1,是一次**删除**而非增量:
  // `cli.console.integrations.behaviors.tuned-by`(值「调节项」)。它原本是七张行为卡
  // 共用的小标题,于是一页里出现七个一模一样的 `<h3>` —— 文档大纲、页内查找、
  // 屏幕阅读器的标题列表都没法拿它定位。改成让标题去命名它所统领的行为本身
  // (卡片正上方已经写着是哪个行为),这个键就没有落点了。
  // 删除路径按注释 ① 的口径处理:先 grep 全仓确认唯一引用点(integrations-view.ts
  // 的 ship list)已随模板一起移除,再两端 locale 同步删,parity 不破。
  // 2026-08-20 (控制台可操作性 W1): 1010 → 1013。净 +3,全部是新增,三条都在补
  // 同一类沉默 —— 页面知道答案却没说出口:
  // 1 条 `cli.console.config.inherited-from`。配置行此前只有两态可说:「已在此处
  // 设置」或者什么都不说。而「什么都不说」压着两件不同的事 —— 没人设过(内置默认
  // 在决定)与上层设了(继承)—— 用户排查「我在项目里看到 silent,这是我设的吗」
  // 时,页面沉默地把两者混为一谈。`{source}` 由已有的 `cli.config.source.*` 填充,
  // 不需要再加来源名的键。
  // 1 条 `cli.console.config.scope-note`。顶栏的作用域下拉对配置页不改任何值
  //(/api/config 刻意不按 scope 重新取根),而它在集成页与状态页是生效的 —— 不说
  // 出来,用户切了项目看到一模一样的一页,得到的结论是「这个下拉坏了」。
  // 1 条 `cli.console.integrations.scope-line`。集成页每一句话都只对一个项目成立,
  // 而选的是哪个项目只写在顶栏。两个项目装出来的东西本就该一样,于是切换后页面
  // 没有任何地方能证明它生效了。
  // 同轮另有 `cli.console.config.reset` 等**值**变更(见 W2),值变更不进 census。
  // 纯增量,按上面的豁免不重跑 dead-key scan。
  // 2026-08-20 (控制台可操作性 W2): 1013 → 1018。净 +5,全部是新增。这一批补的是
  // 「页面说了在别处,却从没说过别处是哪里」:
  // 4 条 `cli.console.integrations.behaviors.*` —— `goto`(跳转按钮的标题)、
  // `turn-off`(关掉提醒的三个层次:全局静音 / 按类型关 / 配置页那三个开关)、
  // `turn-off-hook`(彻底停一个 hook 要改客户端自己的配置,控制台不做 —— 说清做不到,
  // 比让人在页面上找一个不存在的开关好)、`turn-off-link`(去配置页)。
  // 1 条 `cli.console.config.multi-hint` —— 多选控件只有一个「保存」时读起来是单向的,
  // 而「全不勾再保存」与「移除此处设置」看着像同一个手势、意思正好相反。
  // 另有 `cli.console.config.reset` 改了**值**没改 key(「恢复默认」→「移除此处设置」:
  // 它做的是删掉这一层的条目、把决定交回下层,不是把默认值写进来钉死),值变更不进 census。
  // 纯增量,按上面的豁免不重跑 dead-key scan。
  // 2026-08-20 (控制台可操作性 W3): 1018 → 1033。净 +15,全部是新增,全在
  // `cli.console.integrations.cleanup.*`。控制台第一个删文件的能力,文案比别处多的
  // 原因也在这里:删除没有第二次机会,所以每一项都要写清「删的是什么」「删了会
  // 怎样」「什么不在删除范围里」,而不是只给一个按钮名。
  // 2 条区级:`title` / `intro`(先列清单再动手这条规矩本身)。
  // 4 条项级:`orphan` / `orphan-hint`(安装从不删旧文件,所以它们会一直被读到)、
  // `cache` / `cache-hint`(删掉只重置提醒计数,不动知识;正在跑的会话不在其中)。
  // 4 条计数与两步确认:`count` / `none` / `button` / `confirm-hint`。
  // 2 条第二步:`confirm` / `cancel`。
  // 3 条结果:`done` / `mismatch`(确认时 N 个、实际删了 M 个 —— 服务端按当前磁盘
  // 重算,这个窗口不用锁去消除,而是照实报出来)/ `failed`。
  // 纯增量,按上面的豁免不重跑 dead-key scan。
  it("key count matches the pinned census (bump ONLY after re-running the dead-key scan)", () => {
    expect(enKeys.length).toBe(1033);
  });

  it("no key resurrects the deleted v1.8 dashboard namespace", () => {
    // The dashboard subsystem has no source left in the tree — 201 orphaned
    // strings were all that remained of it. A `dashboard.*` key reappearing
    // means someone is reviving a UI that does not exist.
    expect(enKeys.filter((k) => k.startsWith("dashboard."))).toEqual([]);
  });

  // Absorbed from scripts/i18n-audit.mjs check [3] before deleting it: an `en`
  // value containing CJK is an untranslated string that shipped to English
  // users. Its check [4] ("zh value byte-identical to en") was NOT absorbed —
  // 21 of those are intentional (protected tokens, format strings, proper
  // nouns), so as a gate it is pure churn.
  it("no en value carries untranslated CJK", () => {
    const INTENTIONAL_CJK = new Set([
      // Quotes the literal anti-trigger token a SKILL.md description must contain.
      "doctor.check.skill_description.remediation",
      // A language picker labels each language in its own script, by design.
      "cli.install.language.option.zh-CN",
    ]);
    const leaked = enKeys.filter(
      (k) => !INTENTIONAL_CJK.has(k) && /[一-鿿]/.test(enMessages[k]),
    );
    expect(leaked).toEqual([]);
  });
});
