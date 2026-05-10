#!/usr/bin/env node
/**
 * Dogfood harness for Fabric v2.0 rc.2 archive flow (TASK-007).
 *
 * Runs end-to-end against the Fabric self-repo:
 *   1. Installs the fabric-archive SKILL.md template into .claude/skills/ and .codex/skills/.
 *      (Hook script + hook configs are installed by `fabric hooks install`; run that first.)
 *   2. Invokes extractKnowledge() three times with REAL recent decisions/pitfalls/guidelines
 *      drawn from this rc.2 implementation session.
 *   3. Re-invokes ONE of the same triples to prove idempotency (evidence-append, not duplicate).
 *
 * Designed to be re-runnable: every step is idempotent. Pass `--invocations-only` to skip
 * skill install (when hooks/skills already in place) and only re-run the MCP tool calls.
 *
 * Usage:
 *   node scripts/dogfood-rc2-archive.mjs               # full flow
 *   node scripts/dogfood-rc2-archive.mjs --invocations-only
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractKnowledge } from "../packages/server/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const SOURCE_SESSION = "WFS-rc2-impl-2026-05-10";

const INVOCATIONS = [
  {
    type: "decisions",
    slug: "rc2-single-cjs-hook-across-clients",
    user_messages_summary:
      "rc.2 决定使用单份 .cjs hook 脚本（archive-hint.cjs）同时服务 Claude Code 和 Codex CLI 两个客户端，而非每客户端一份。" +
      "依据：现存 fabric-init-reminder.cjs 和 fabric-stop-reminder.cjs 已验证两个客户端都接受相同的 stdout JSON 形态 " +
      "{decision:'block',reason:string}；维护单一脚本避免重复实现 events.jsonl 解析与阈值逻辑。" +
      "记录于 packages/cli/templates/hooks/archive-hint.cjs，被 .claude/hooks/ 与 .codex/hooks/ 同时引用。",
    recent_paths: [
      "packages/cli/templates/hooks/archive-hint.cjs",
      "packages/cli/templates/hooks/configs/claude-code.json",
      "packages/cli/templates/hooks/configs/codex-hooks.json",
      ".workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/planning-context.md",
    ],
  },
  {
    type: "pitfalls",
    slug: "codex-hook-config-is-json-not-toml",
    user_messages_summary:
      "陷阱：Codex CLI 的 project-level hook 配置文件是 .codex/hooks.json，不是 .codex/hooks.toml。" +
      "用户级别的 MCP 配置 (~/.codex/config.toml) 才是 TOML；项目级 hooks 使用 JSON。" +
      "排查锚点：packages/cli/src/config/resolver.ts:157 显式探测 existsSync(workspaceRoot, '.codex', 'hooks.json')。" +
      "rc.2 原始 handoff.json 误标为 .toml，已在 schema-deviations 表里更正。",
    recent_paths: [
      "packages/cli/src/config/resolver.ts",
      "packages/cli/templates/hooks/configs/codex-hooks.json",
    ],
  },
  {
    type: "guidelines",
    slug: "deepmerge-array-append-paths-for-stop-hooks",
    user_messages_summary:
      "指导：当向已存在的 .claude/settings.json 合并 hooks.Stop[] 数组时，必须使用 deepMerge 的 arrayAppendPaths 选项 " +
      "（按 command 字符串 dedupe），而非默认的数组替换语义。" +
      "默认 deepMerge 在 packages/cli/src/config/json.ts:18-39 直接 REPLACE 数组，会覆盖用户已有的 Stop 钩子。" +
      "TASK-005 已扩展 deepMerge 支持 arrayAppendPaths: ['hooks.Stop'] 以保留用户配置且对 fabric-archive 入口去重。" +
      "复用模式：未来任何写入 settings.json hooks.* 数组的 init 步骤必须沿用此选项。",
    recent_paths: [
      "packages/cli/src/config/json.ts",
      "packages/cli/src/install/skills-and-hooks.ts",
    ],
  },
];

// Idempotency replay target: re-invoke the FIRST entry with a different summary string
// to prove (a) same idempotency_key returned, (b) body augmented with `## Evidence (call 2)`
// section, (c) NO duplicate file created.
const REPLAY_INDEX = 0;
const REPLAY_FOLLOWUP_SUMMARY =
  "二次调用：验证 idempotency_key 在 (source_session,type,slug) 三元组未变时保持稳定，" +
  "且 LLM 重新生成的 summary 应 append 到 ## Evidence (call N) 而不是覆盖原内容。" +
  "本次模拟 LLM 在同一会话中对同一决策再次抽取 — 结果应是 events.jsonl 多一条 knowledge_proposed 但 " +
  ".fabric/knowledge/pending/decisions/ 下文件数不变。";

async function installSkillTemplate() {
  const sourcePath = join(REPO_ROOT, "packages/cli/templates/skills/fabric-archive/SKILL.md");
  if (!existsSync(sourcePath)) {
    throw new Error(`SKILL template missing: ${sourcePath}`);
  }
  const targets = [
    join(REPO_ROOT, ".claude/skills/fabric-archive/SKILL.md"),
    join(REPO_ROOT, ".codex/skills/fabric-archive/SKILL.md"),
  ];
  const written = [];
  const skipped = [];
  const sourceContent = readFileSync(sourcePath, "utf8");
  for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target) && readFileSync(target, "utf8") === sourceContent) {
      skipped.push(target);
      continue;
    }
    copyFileSync(sourcePath, target);
    written.push(target);
  }
  return { written, skipped };
}

async function runInvocations() {
  const results = [];
  for (const input of INVOCATIONS) {
    const out = await extractKnowledge(REPO_ROOT, {
      source_session: SOURCE_SESSION,
      ...input,
    });
    results.push({ input, output: out });
  }
  return results;
}

async function runReplay() {
  const replayInput = INVOCATIONS[REPLAY_INDEX];
  const out = await extractKnowledge(REPO_ROOT, {
    source_session: SOURCE_SESSION,
    type: replayInput.type,
    slug: replayInput.slug,
    user_messages_summary: REPLAY_FOLLOWUP_SUMMARY,
    recent_paths: replayInput.recent_paths,
  });
  return { input: { ...replayInput, user_messages_summary: REPLAY_FOLLOWUP_SUMMARY }, output: out };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const invocationsOnly = args.has("--invocations-only");

  if (!invocationsOnly) {
    const skillResult = await installSkillTemplate();
    console.log(JSON.stringify({ step: "install-skill", ...skillResult }, null, 2));
  }

  const initial = await runInvocations();
  console.log(JSON.stringify({ step: "initial-invocations", count: initial.length, results: initial }, null, 2));

  const replay = await runReplay();
  console.log(JSON.stringify({ step: "replay", result: replay }, null, 2));

  const sameKey = initial[REPLAY_INDEX].output.idempotency_key === replay.output.idempotency_key;
  const samePath = initial[REPLAY_INDEX].output.pending_path === replay.output.pending_path;
  console.log(JSON.stringify({
    step: "idempotency-check",
    same_idempotency_key: sameKey,
    same_pending_path: samePath,
    initial_key: initial[REPLAY_INDEX].output.idempotency_key,
    replay_key: replay.output.idempotency_key,
  }, null, 2));

  if (!sameKey || !samePath) {
    console.error("IDEMPOTENCY CHECK FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("dogfood-rc2-archive failed:", err);
  process.exit(1);
});
