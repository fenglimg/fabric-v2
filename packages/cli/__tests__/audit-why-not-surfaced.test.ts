import { describe, expect, it } from "vitest";

import auditCommand from "../src/commands/audit.js";

// W3-H (S6): `fabric audit why-not-surfaced <id>` is wired as a real audit
// subcommand (read-only diagnostic, consistent with W3-D's audit group). The
// verdict logic itself is covered by the server's why-not-surfaced.test.ts.
describe("audit why-not-surfaced subcommand wiring (W3-H)", () => {
  it("registers `why-not-surfaced` under audit", () => {
    const sub = auditCommand.subCommands as Record<string, unknown> | undefined;
    expect(sub?.["why-not-surfaced"]).toBeDefined();
  });

  it("requires a positional `id` argument", () => {
    const cmd = (auditCommand.subCommands as Record<string, { args: Record<string, { type: string; required?: boolean }> }>)[
      "why-not-surfaced"
    ];
    expect(cmd.args.id.type).toBe("positional");
    expect(cmd.args.id.required).toBe(true);
  });
});
