import { describe, expect, it } from "vitest";

import { createTranslator } from "@fenglimg/fabric-shared";

import { createStoreCounterCheck, type StoreCounterDrift } from "./doctor-store-counters.js";

describe("createStoreCounterCheck", () => {
  const t = createTranslator("en");

  it("renders ok when no store counter drift exists", () => {
    const check = createStoreCounterCheck(t, []);

    expect(check.status).toBe("ok");
    expect(check.kind).toBeUndefined();
    expect(check.code).toBeUndefined();
  });

  it("renders counter drift as a fixable error", () => {
    const drift: StoreCounterDrift = {
      store_alias: "team",
      store_uuid: "44444444-4444-4444-8444-444444444444",
      store_dir: "stores/team",
      layer: "KT",
      type: "DEC",
      current: 3,
      disk_max: 7,
    };

    const check = createStoreCounterCheck(t, [drift]);

    expect(check.status).toBe("error");
    expect(check.kind).toBe("fixable_error");
    expect(check.code).toBe("store_counter_drift");
    expect(check.fixable).toBe(true);
    expect(check.message).toContain("team");
    expect(check.message).toContain("disk max is 7");
    expect(check.actionHint).toContain("fabric doctor --fix");
  });
});
