// surface-derive.mjs — shared surface inventory derivation for G-CENSUS + G-SELFAUDIT.
//
// Single source of truth: both the census (scorecard generator) and the
// self-audit (anti-rot diff) derive the live surface set the same way, so a
// surface added to a registry shows up identically in both — the self-audit can
// then catch a scorecard that was not regenerated.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));

// Live event-producer set: event_type -> Set<sourceFileRel>, scanned from writer
// surfaces (src .ts excluding tests + hook .cjs templates).
export function deriveProducers() {
  const producers = {};
  const scan = (relDir) => {
    for (const ent of readdirSync(join(ROOT, relDir), { withFileTypes: true })) {
      const childRel = `${relDir}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist") continue;
        scan(childRel);
      } else if (/\.(ts|cjs|mjs)$/.test(ent.name) && !/\.test\.ts$/.test(ent.name)) {
        const body = readFileSync(join(ROOT, childRel), "utf8");
        const re = /event_type:\s*["']([a-z_]+)["']/g;
        let m;
        while ((m = re.exec(body))) (producers[m[1]] ??= new Set()).add(childRel);
      }
    }
  };
  scan("packages/cli/src");
  scan("packages/server/src");
  scan("packages/cli/templates/hooks");
  return producers;
}

const fileEmits = (producers, suffix) =>
  Object.entries(producers)
    .filter(([, srcs]) => [...srcs].some((s) => s.endsWith(suffix)))
    .map(([evt]) => evt);

function cliSurfaces(producers) {
  const idx = read("packages/cli/src/commands/index.ts");
  const rows = [];
  const re = /["']?([a-z0-9-]+)["']?\s*:\s*\(\)\s*=>\s*import\(["']\.\/([a-z0-9-]+)\.js["']\)/g;
  let m;
  while ((m = re.exec(idx))) {
    const [, name, target] = m;
    const impl = `packages/cli/src/commands/${target}.ts`;
    const wired = exists(impl) && read(impl).trim().length > 200;
    const events = wired ? fileEmits(producers, `commands/${target}.ts`) : [];
    rows.push({ surface: "cli", name, impl, wired, observable: events.length > 0, events });
  }
  return rows;
}

function mcpSurfaces(producers) {
  const dir = "packages/server/src/tools";
  const rows = [];
  for (const f of readdirSync(join(ROOT, dir))) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const body = read(`${dir}/${f}`);
    const name = body.match(/registerTool\(\s*[\s\S]{0,40}?["'](fab_[a-z_]+)["']/);
    if (!name) continue;
    const events = fileEmits(producers, `tools/${f}`);
    rows.push({
      surface: "mcp",
      name: name[1],
      impl: `${dir}/${f}`,
      wired: body.includes("registerTool") && body.length > 200,
      observable: events.length > 0,
      events,
    });
  }
  return rows;
}

function skillSurfaces(producers) {
  const dir = "packages/cli/templates/skills";
  const skillEvents = Object.keys(producers).filter(
    (e) => e.startsWith("skill_invocation") || e === "skill_phase_transition",
  );
  const rows = [];
  for (const ent of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === "lib") continue;
    const md = `${dir}/${ent.name}/SKILL.md`;
    const wired = exists(md) && read(md).includes("---") && read(md).trim().length > 200;
    rows.push({
      surface: "skill",
      name: ent.name,
      impl: md,
      wired,
      observable: skillEvents.length > 0,
      events: skillEvents,
    });
  }
  return rows;
}

function hookSurfaces(producers) {
  const dir = "packages/cli/templates/hooks";
  const rows = [];
  for (const f of readdirSync(join(ROOT, dir))) {
    if (!f.endsWith(".cjs")) continue;
    const events = fileEmits(producers, `hooks/${f}`);
    rows.push({
      surface: "hook",
      name: f.replace(/\.cjs$/, ""),
      impl: `${dir}/${f}`,
      wired: read(`${dir}/${f}`).trim().length > 200,
      observable: events.length > 0,
      events,
    });
  }
  return rows;
}

// Full live surface inventory across all 4 registries.
export function deriveSurfaces() {
  const producers = deriveProducers();
  return [
    ...cliSurfaces(producers),
    ...mcpSurfaces(producers),
    ...skillSurfaces(producers),
    ...hookSurfaces(producers),
  ];
}
