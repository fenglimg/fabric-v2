import { describe, expect, it, vi } from "vitest";

import { createTranslator, detectNodeLocale } from "@fenglimg/fabric-shared";

import { assessBodyAltitude } from "./body-altitude.js";
import { createBodyAltitudeDumpCheck } from "./doctor-body-altitude.js";
import { extractBody } from "./_shared.js";

const t = createTranslator(detectNodeLocale());

describe("doctor body altitude body scan (peer micro-transfer P0-2 / COR-002)", () => {
  it("detects dump markers living only in markdown body (not description fields)", () => {
    const raw = [
      "---",
      "id: KT-GLD-9999",
      "title: Session dump",
      "summary: Short summary without role turns.",
      "---",
      "",
      "User: what happened in the meeting?",
      "Assistant: we talked about many things.",
      "User: can you dump the transcript?",
      "Assistant: sure, here is everything.",
    ].join("\n");
    const summary = "Short summary without role turns.";
    const bodyText = extractBody(raw).trim();
    const proxyOnly = assessBodyAltitude("", summary, "guidelines");
    expect(proxyOnly.ok).toBe(true);
    const fromBody = assessBodyAltitude(bodyText, summary, "guidelines");
    expect(fromBody.ok).toBe(false);
    if (!fromBody.ok) {
      expect(fromBody.code).toMatch(/body_altitude_/);
    }
    const check = createBodyAltitudeDumpCheck(t, {
      entries: [
        {
          stable_id: "team:KT-GLD-9999",
          path: "/tmp/store/knowledge/guidelines/KT-GLD-9999.md",
          code: fromBody.ok ? "ok" : fromBody.code,
          detail: fromBody.ok ? "" : fromBody.detail,
        },
      ],
    });
    expect(check.status).toBe("warn");
    expect(check.code).toBe("knowledge_body_altitude_dump");
  });

  it("COR-004: structured guidelines with H2 + transcript header do not fail", () => {
    const body = [
      "## Anti-pattern",
      "Do not paste a session transcript or chat log dump.",
      "User: example of bad role marker in a doc",
      "Assistant: still structured under H2",
    ].join("\n");
    const a = assessBodyAltitude(body, "How to write guidelines", "guidelines");
    expect(a.ok).toBe(true);
  });

  it("inspectBodyAltitude assesses entry.body via collectStoreCanonicalEntries", async () => {
    const dumpBody = [
      "---",
      "id: KT-GLD-9999",
      "summary: Clean short summary.",
      "---",
      "",
      "User: recount the whole session",
      "Assistant: turn one",
      "User: keep going",
      "Assistant: turn two more chatter",
    ].join("\n");

    vi.resetModules();
    vi.doMock("./cross-store-recall.js", () => ({
      collectStoreCanonicalEntries: vi.fn().mockResolvedValue([
        {
          qualifiedId: "team:KT-GLD-9999",
          file: "/tmp/store/knowledge/guidelines/KT-GLD-9999.md",
          type: "guidelines",
          body: dumpBody,
          description: { summary: "Clean short summary.", knowledge_type: "guidelines" },
        },
      ]),
    }));
    const { inspectBodyAltitude } = await import("./doctor-body-altitude.js");
    const inspection = await inspectBodyAltitude("/tmp/project");
    expect(inspection.errored).toBeFalsy();
    expect(inspection.entries.length).toBeGreaterThan(0);
  });

  it("COR-007: corpus walk failure yields errored inspection (not fake clean)", async () => {
    vi.resetModules();
    vi.doMock("./cross-store-recall.js", () => ({
      collectStoreCanonicalEntries: vi.fn().mockRejectedValue(new Error("boom-walk")),
    }));
    const { inspectBodyAltitude, createBodyAltitudeDumpCheck } = await import(
      "./doctor-body-altitude.js"
    );
    const inspection = await inspectBodyAltitude("/tmp/project");
    expect(inspection.errored).toBe(true);
    expect(inspection.entries).toEqual([]);
    const check = createBodyAltitudeDumpCheck(t, inspection);
    expect(check.status).toBe("warn");
    expect(check.code).toBe("knowledge_body_altitude_scan_error");
  });
});
