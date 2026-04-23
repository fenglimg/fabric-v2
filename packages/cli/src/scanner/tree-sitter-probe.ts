import { realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const PROBE_SOURCE = `import { strict as assert } from "node:assert";

const users = [{ id: "1", name: "Ada" }];

export function findUser(id) {
  return users.find((user) => user.id === id);
}

assert.equal(findUser("1")?.name, "Ada");
console.log("parsed");`;

type TreeSitterModule = typeof import("web-tree-sitter");
type TreeSitterLanguage = import("web-tree-sitter").Language;

export type TreeSitterProbeResult = {
  ok: boolean;
  node_version: string;
  package_engines: "not-declared";
  root_node_type: string;
  has_error: boolean;
  elapsed_ms: number;
  wasm: {
    runtime_path: string;
    runtime_bytes: number;
    javascript_grammar_path: string;
    javascript_grammar_bytes: number;
  };
  decision: {
    status: "feasible";
    loading_strategy: "lazy";
    bundle_size_impact: string;
    grammar_strategy: string;
    integration_note: string;
  };
};

type TreeSitterAssetPaths = {
  runtimeWasmPath: string;
  javascriptGrammarPath: string;
};

let treeSitterModulePromise: Promise<TreeSitterModule> | null = null;
let parserInitPromise: Promise<void> | null = null;
let javascriptLanguagePromise: Promise<TreeSitterLanguage> | null = null;

export async function runTreeSitterProbe(source = PROBE_SOURCE): Promise<TreeSitterProbeResult> {
  const startedAt = performance.now();
  const assets = resolveTreeSitterAssets();
  const treeSitter = await loadTreeSitterModule();
  await initParser(treeSitter, assets.runtimeWasmPath);
  const language = await loadJavaScriptLanguage(treeSitter, assets.javascriptGrammarPath);
  const parser = new treeSitter.Parser();
  const runtimeBytes = statSync(assets.runtimeWasmPath).size;
  const javascriptGrammarBytes = statSync(assets.javascriptGrammarPath).size;
  let tree: import("web-tree-sitter").Tree | null = null;

  try {
    parser.setLanguage(language);
    tree = parser.parse(source);

    if (tree === null) {
      throw new Error("web-tree-sitter probe failed: parser returned null syntax tree");
    }

    const rootNode = tree.rootNode;
    return {
      ok: !rootNode.hasError,
      node_version: process.version,
      package_engines: "not-declared",
      root_node_type: rootNode.type,
      has_error: rootNode.hasError,
      elapsed_ms: Math.round(performance.now() - startedAt),
      wasm: {
        runtime_path: assets.runtimeWasmPath,
        runtime_bytes: runtimeBytes,
        javascript_grammar_path: assets.javascriptGrammarPath,
        javascript_grammar_bytes: javascriptGrammarBytes,
      },
      decision: {
        status: "feasible",
        loading_strategy: "lazy",
        bundle_size_impact: formatBundleImpact(runtimeBytes, javascriptGrammarBytes),
        grammar_strategy: "Use tree-sitter-javascript WASM for JavaScript and TS-compatible syntax; evaluate tree-sitter-typescript before parsing TypeScript-only syntax.",
        integration_note: "Keep web-tree-sitter behind a dynamic import at the forensic inferPatternHint() call site to avoid CLI startup cost.",
      },
    };
  } finally {
    tree?.delete();
    parser.delete();
  }
}

function resolveTreeSitterAssets(): TreeSitterAssetPaths {
  return {
    runtimeWasmPath: require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    javascriptGrammarPath: require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"),
  };
}

function loadTreeSitterModule(): Promise<TreeSitterModule> {
  treeSitterModulePromise ??= import("web-tree-sitter");
  return treeSitterModulePromise;
}

function initParser(treeSitter: TreeSitterModule, runtimeWasmPath: string): Promise<void> {
  parserInitPromise ??= treeSitter.Parser.init({
    locateFile: (scriptName: string) => (scriptName.endsWith(".wasm") ? runtimeWasmPath : scriptName),
  });
  return parserInitPromise;
}

function loadJavaScriptLanguage(
  treeSitter: TreeSitterModule,
  javascriptGrammarPath: string,
): Promise<TreeSitterLanguage> {
  javascriptLanguagePromise ??= treeSitter.Language.load(javascriptGrammarPath);
  return javascriptLanguagePromise;
}

function formatBundleImpact(runtimeBytes: number, javascriptGrammarBytes: number): string {
  const combinedBytes = runtimeBytes + javascriptGrammarBytes;
  return `${formatBytes(combinedBytes)} combined WASM payload (${formatBytes(runtimeBytes)} runtime + ${formatBytes(javascriptGrammarBytes)} JavaScript grammar); package unpacked sizes are larger and acceptable only with lazy loading.`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

const entrypoint = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = entrypoint !== undefined && realpathSync(resolve(entrypoint)) === currentFilePath;

if (isMainModule) {
  runTreeSitterProbe()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`web-tree-sitter probe failed: ${message}`);
      process.exitCode = 1;
    });
}
