#!/usr/bin/env node
// B2 S1 — 22 条语义淘汰(deprecate-over-delete,不硬删)。
//
//   node retire-entries.mjs --store <store 根> --project-root <绑该 store 的仓库> [--dry]
//
// 写入面刻意复刻 `retireOne`(packages/server/src/services/review/review-write-actions.ts)
// 的真实形状,而不是自创一套:
//   ① frontmatter 只**合并** `deprecated: true`(+ 可选 `superseded_by`),
//      其余键(id / type / summary / 正文)逐字保留;
//   ② 理由不进正文 —— 落在 projectRoot/.fabric/events.jsonl 的
//      `knowledge_modified` 事件里,`reason` 形如 `retire:<path>: <理由>`。
//
// 走脚本而不是 fab_review,是因为 MCP server 的 projectRoot 锁在 pcf(只绑
// fabric-team),解析不到 wespy 的路径 —— 那是正确行为,不是故障。判决逐条依据见
// 同目录 triage.md。

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const STORE = flag("--store");
const PROJECT_ROOT = flag("--project-root");
if (STORE === undefined || PROJECT_ROOT === undefined) {
  console.error("usage: retire-entries.mjs --store <store-root> --project-root <repo> [--dry]");
  process.exit(2);
}
const K = join(STORE, "knowledge");
const P = join(K, "projects", "werewolf-minigame");

const GROUPS = [
  {
    reason:
      "doc 镜像:正文即「见 docs/voice-room-extension/spec-*.md」,无 doc 之外的增量。留存判据 A 轴 —— 手抄清单必漂,应指向权威源而非抄一份。",
    paths: [
      `${P}/guidelines/KT-GLD-0003--voice-room-component-extension-spec.md`,
      `${P}/guidelines/KT-GLD-0004--voice-room-extension-navigation.md`,
      `${P}/guidelines/KT-GLD-0005--voice-room-feature-plugin-spec.md`,
      `${P}/guidelines/KT-GLD-0006--voice-room-view-spec.md`,
      `${P}/guidelines/KT-GLD-0007--voice-room-viewmodel-spec.md`,
      `${P}/guidelines/KT-GLD-0008--wolfgame-key-implementation-patterns.md`,
      `${P}/processes/KT-PRO-0006--voice-room-workflows-spec.md`,
      `${K}/processes/KT-PRO-0001--android-platform-migration-guide.md`,
    ],
  },
  {
    reason:
      "模块总览 / 数据模型字段 / 协议格式 / 分层结构 —— 留存判据明确不留:信息代码里已经有,且代码形状直接读得出来,两条同时成立。架构总览不等于架构决策(后者才是长期资产)。",
    paths: [
      `${P}/models/KT-MOD-0001--game-center-module-overview.md`,
      `${P}/models/KT-MOD-0002--voice-room-data-model-spec.md`,
      `${P}/models/KT-MOD-0003--voice-room-music-widget-design.md`,
      `${P}/models/KT-MOD-0004--voice-room-seat-system-spec.md`,
      `${P}/models/KT-MOD-0005--wolfgame-audio-animation-system.md`,
      `${P}/models/KT-MOD-0006--wolfgame-data-models.md`,
      `${P}/models/KT-MOD-0007--wolfgame-mvvm-mobx-architecture.md`,
      `${P}/models/KT-MOD-0008--wolfgame-phase-state-machine.md`,
      `${P}/models/KT-MOD-0009--wolfgame-ui-layer-system.md`,
      `${P}/models/KT-MOD-0010--wolfgame-ws-frame-protocol.md`,
    ],
  },
  {
    reason: "一次性项管计划 —— 需求已落地,计划本身不再被读,且腐烂快(留存判据 B 轴)。",
    paths: [
      `${P}/processes/KT-PRO-0002--cpgame-lover-publish-plan.md`,
      `${P}/processes/KT-PRO-0003--cpgame-progress-status-plan.md`,
    ],
  },
  {
    reason:
      "已完成的一次性迁移指南;其中仍成立的原则(共用基建保留、玩法私有字段下沉)已由 KT-DEC-0003 承载。",
    supersededBy: "KT-DEC-0003",
    paths: [`${P}/processes/KT-PRO-0004--spy-game-migration-guide.md`],
  },
  {
    reason:
      "落点是「查了一圈发现不是问题」—— 原文自陈「后确认可能是开发缓存导致,小游戏线上通常同批包不会出现」。没有可复用的判据,留着只会让下一个人以为有坑。",
    paths: [`${P}/pitfalls/KT-PIT-0012--remote-bundle-new-common-api-cache-order.md`],
  },
];

// frontmatter 标量合并:键已存在就整行替换,否则插在闭合 `---` 前。
// 只碰这两个键 —— 其余逐字保留,这是 deprecate-over-delete 的全部意思。
function mergeScalar(raw, key, value) {
  const m = /^(---\n)([\s\S]*?)(\n---\n)/u.exec(raw);
  if (m === null) throw new Error("no frontmatter");
  const [, open, body, close] = m;
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:.*$`, "mu");
  const nextBody = re.test(body) ? body.replace(re, line) : `${body}\n${line}`;
  return open + nextBody + close + raw.slice(m[0].length);
}

const eventsPath = join(PROJECT_ROOT, ".fabric", "events.jsonl");
const stamp = new Date().toISOString();
let done = 0;
const events = [];

for (const g of GROUPS) {
  for (const path of g.paths) {
    const raw = readFileSync(path, "utf8");
    const idm = /^id:\s*(.*)$/mu.exec(raw);
    const stableId = idm ? idm[1].trim().replace(/^["']|["']$/gu, "") : undefined;
    const wasDeprecated = /^deprecated:\s*true\s*$/mu.test(raw);

    let next = mergeScalar(raw, "deprecated", "true");
    if (g.supersededBy !== undefined) next = mergeScalar(next, "superseded_by", g.supersededBy);
    if (!DRY) writeFileSync(path, next);

    const changed = g.supersededBy !== undefined ? ["deprecated", "superseded_by"] : ["deprecated"];
    const before = { deprecated: wasDeprecated ? true : null };
    const after = { deprecated: true };
    if (g.supersededBy !== undefined) {
      before.superseded_by = null;
      after.superseded_by = g.supersededBy;
    }
    events.push({
      kind: "fabric-event",
      id: `event:${randomUUID()}`,
      ts: Date.now(),
      schema_version: 1,
      event_type: "knowledge_modified",
      ...(stableId === undefined ? {} : { stable_id: stableId }),
      timestamp: stamp,
      path,
      changed_fields: changed,
      before,
      after,
      reason: `retire:${path}: ${g.reason}`,
    });
    done++;
    console.log(`${DRY ? "would retire" : "retired"}  ${stableId ?? "?"}  ${path.slice(K.length + 1)}`);
  }
}

if (!DRY) {
  for (const ev of events) {
    const line = JSON.stringify(ev);
    if (Buffer.byteLength(line) + 1 > 4096) throw new Error("event line exceeds 4KB atomicity budget");
    appendFileSync(eventsPath, line + "\n");
  }
}
console.log(`\n${DRY ? "(dry run)" : "written"}: ${done} entries, ${DRY ? 0 : events.length} lifecycle events`);
