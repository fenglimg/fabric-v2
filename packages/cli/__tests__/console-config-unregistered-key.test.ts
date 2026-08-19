/**
 * AC5 — a field the presentation registry has never heard of must RENDER, in
 * "advanced", rather than disappear.
 *
 * This is the one property the two-tier settings page could plausibly break, and
 * it cannot be tested from inside the registry: `tierOf("unknown") === "advanced"`
 * is true by construction and proves nothing about whether the page then draws
 * the field. So the panel field list itself is extended with a synthetic knob and
 * the assertion is made against the payload the page actually receives.
 *
 * Own file because the mock is module-level: every other suite must keep seeing
 * the real nineteen fields.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The key deliberately absent from `config-presentation.ts`. */
const NEW_KEY = "a_knob_added_after_the_registry_was_written";

vi.mock("@fenglimg/fabric-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fenglimg/fabric-shared")>();
  // Shaped like the introspection output for a boolean knob, because that is
  // what adding one to the zod schema would produce.
  const synthetic = {
    key: NEW_KEY,
    group: "D_behavior",
    home: "preference",
    type: "boolean",
    widget: "select",
    enum_values: ["true", "false"],
    label_i18n_key: `cli.config.fields.${NEW_KEY}.label`,
    description_i18n_key: `cli.config.fields.${NEW_KEY}.description`,
    default: true,
    validate: (raw: string) => ({ ok: true as const, value: raw === "true" }),
    format_for_display: (value: unknown) => String(value),
  };
  return {
    ...actual,
    getPanelFields: () => [...actual.getPanelFields(), synthetic],
  };
});

const { collectGlobalConfigView } = await import("../src/console/global-config-view.ts");
const { tierOf } = await import("../src/console/config-presentation.ts");

const dirs: string[] = [];
let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fab-unreg-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
  mkdirSync(join(home, ".fabric"), { recursive: true });
  writeFileSync(
    join(home, ".fabric", "fabric-global.json"),
    JSON.stringify({ uid: "u-test", stores: [] }, null, 2),
    "utf8",
  );
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = savedHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function bareDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-unreg-bare-"));
  dirs.push(dir);
  return dir;
}

describe("a schema key the presentation registry does not know (AC5)", () => {
  it("is still in the payload, tiered advanced", async () => {
    const view = await collectGlobalConfigView(bareDir());
    const added = view.machine.find((f) => f.key === NEW_KEY);

    // Present at all — the failure this guards is silent omission, so the first
    // assertion has to be existence, not tier.
    expect(added).toBeDefined();
    expect(added?.tier).toBe("advanced");
    // And it renders like any other field: editable, with its own control.
    expect(added?.widget).toBe("select");
    expect(added?.editable).toBe(true);
  });

  it("the mock is actually reaching the view", async () => {
    // Without this the test above could pass against an accidental no-op mock by
    // finding nothing and... no: `toBeDefined` would fail. But it could pass for
    // the WRONG reason if the registry had somehow been taught the key, so pin
    // that it has not.
    expect(tierOf(NEW_KEY)).toBe("advanced");
    const view = await collectGlobalConfigView(bareDir());
    expect(view.machine.map((f) => f.key)).toContain(NEW_KEY);
    expect(view.machine.filter((f) => f.tier === "common").length).toBeGreaterThan(0);
  });
});
