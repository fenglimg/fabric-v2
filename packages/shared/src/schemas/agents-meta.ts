import { z } from "zod";

export const agentsMetaNodeSchema = z.object({
  file: z.string(),
  scope_glob: z.string(),
  deps: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  hash: z.string(),
});

export const agentsMetaSchema = z.object({
  revision: z.string(),
  nodes: z.record(agentsMetaNodeSchema),
});
