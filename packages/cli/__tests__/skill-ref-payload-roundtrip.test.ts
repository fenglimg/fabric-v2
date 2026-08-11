import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { SKILL_DESTINATIONS } from "../src/install/distribution-targets.ts";
import {
  installFabricArchiveSkill,
  installFabricConfigSkill,
  installFabricRecallPlaybookSkill,
  installFabricReviewSkill,
  installFabricStoreSkill,
  installFabricSyncSkill,
} from "../src/install/install-skills.ts";

// Producer-consumer round-trip over the skill payload: the SKILL.md a user gets
// is the CONSUMER of its ref/ companions, and `fabric install` is the PRODUCER.
// Checking either side alone is false-green — the templates all parsed fine and
// every installer reported success while fabric-recall-playbook shipped a
// SKILL.md that told the agent to open `ref/scenarios.md`, a file install had
// never written. Only running install and re-reading what landed on disk shows
// it. The reverse direction is the "is this artifact necessary?" axis: a ref
// file nobody names is payload the agent will never open.

const SKILLS = {
  "fabric-archive": { install: installFabricArchiveSkill, dest: SKILL_DESTINATIONS.fabricArchive },
  "fabric-review": { install: installFabricReviewSkill, dest: SKILL_DESTINATIONS.fabricReview },
  "fabric-sync": { install: installFabricSyncSkill, dest: SKILL_DESTINATIONS.fabricSync },
  "fabric-store": { install: installFabricStoreSkill, dest: SKILL_DESTINATIONS.fabricStore },
  "fabric-recall-playbook": {
    install: installFabricRecallPlaybookSkill,
    dest: SKILL_DESTINATIONS.fabricRecallPlaybook,
  },
  "fabric-config": { install: installFabricConfigSkill, dest: SKILL_DESTINATIONS.fabricConfig },
} as const;

const SKILL_SLUGS = Object.keys(SKILLS) as Array<keyof typeof SKILLS>;

const templatesDir = fileURLToPath(new URL("../templates/skills", import.meta.url));

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "skillref-"));
  roots.push(root);
  return root;
}

/** Template ref/*.md basenames for a skill; `[]` when the skill has no ref/. */
function templateRefFiles(slug: string): string[] {
  const dir = join(templatesDir, slug, "ref");
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")).sort() : [];
}

/** Basenames the SKILL.md prose points the agent at, e.g. `ref/scenarios.md`. */
function referencedRefFiles(slug: string): string[] {
  const src = readFileSync(join(templatesDir, slug, "SKILL.md"), "utf8");
  const named = new Set<string>();
  for (const match of src.matchAll(/ref\/([A-Za-z0-9._-]+\.md)/g)) named.add(match[1] as string);
  return [...named].sort();
}

describe("skill ref payload round-trip", () => {
  it.each(SKILL_SLUGS)("%s: every ref file the SKILL.md names is installed", async (slug) => {
    const referenced = referencedRefFiles(slug);
    const root = makeRoot();

    await SKILLS[slug].install(root);

    for (const clientRel of SKILLS[slug].dest) {
      // `.claude/skills/<slug>/SKILL.md` → `.claude/skills/<slug>/ref/`
      const refDir = join(root, clientRel.replace(/SKILL\.md$/, "ref"));
      for (const name of referenced) {
        expect(
          existsSync(join(refDir, name)),
          `${slug}/SKILL.md points at ref/${name}, but install never wrote it to ${clientRel}`,
        ).toBe(true);
      }
    }
  });

  it.each(SKILL_SLUGS)("%s: installs exactly the template's ref files, nothing else", async (slug) => {
    const expected = templateRefFiles(slug);
    const root = makeRoot();

    await SKILLS[slug].install(root);

    for (const clientRel of SKILLS[slug].dest) {
      const refDir = join(root, clientRel.replace(/SKILL\.md$/, "ref"));
      const landed = existsSync(refDir)
        ? readdirSync(refDir).filter((n) => n.endsWith(".md")).sort()
        : [];
      expect(landed).toEqual(expected);
    }
  });

  // A ref file no SKILL.md names is dead payload: shipped to every client dir,
  // counted against the skill's footprint, and never opened. This is the census
  // gate for the install-artifact-necessity axis — a new ref/ companion has to
  // be linked from the prose, or deleted.
  it.each(SKILL_SLUGS)("%s: has no ref file the SKILL.md never mentions", (slug) => {
    const referenced = new Set(referencedRefFiles(slug));
    const orphans = templateRefFiles(slug).filter((name) => !referenced.has(name));

    expect(orphans, `${slug} ships ref files no prose points at`).toEqual([]);
  });

  // The named-but-missing direction, checked against the template tree rather
  // than an install, so the failure names the authoring mistake directly.
  it.each(SKILL_SLUGS)("%s: names no ref file that does not exist", (slug) => {
    const present = new Set(templateRefFiles(slug));
    const dangling = referencedRefFiles(slug).filter((name) => !present.has(name));

    expect(dangling, `${slug}/SKILL.md points at ref files that are not in the template`).toEqual(
      [],
    );
  });
});
