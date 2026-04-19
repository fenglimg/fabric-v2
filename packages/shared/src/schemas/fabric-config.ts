import { z } from "zod";

export interface ClientPaths {
  claudeCodeCLI?: string;
  claudeCodeDesktop?: string;
  cursor?: string;
  windsurf?: string;
  rooCode?: string;
  geminiCLI?: string;
  codexCLI?: string;
}

export interface FabricConfig {
  clientPaths?: ClientPaths;
  externalFixturePath?: string;
  scanIgnores?: string[];
}

export const clientPathsSchema = z.object({
  claudeCodeCLI: z.string().optional(),
  claudeCodeDesktop: z.string().optional(),
  cursor: z.string().optional(),
  windsurf: z.string().optional(),
  rooCode: z.string().optional(),
  geminiCLI: z.string().optional(),
  codexCLI: z.string().optional(),
});

export const fabricConfigSchema = z.object({
  clientPaths: clientPathsSchema.optional(),
  externalFixturePath: z.string().optional(),
  scanIgnores: z.array(z.string()).optional(),
});
