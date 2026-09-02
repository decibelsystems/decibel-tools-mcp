/**
 * Agentic Pack Engine — module surface.
 *
 * The engine itself lives in sibling modules: compiler (config → versioned,
 * hashed pack), renderer (payload → text via pack templates), linter (output vs
 * pack constraints), golden (regression harness). This file only re-exports
 * them, and is imported by src/tools/agentic/index.ts, which is what actually
 * exposes the tools.
 *
 * It used to also carry registerAgenticTools(server: McpServer) and the zod
 * schemas that function validated its inputs with. That registration path died
 * when server.ts was split into modules (ISS-0029): nothing called it, so its
 * validation validated nothing — while still typechecking and importing
 * cleanly, which is why it went unnoticed for 7.7 months and ~98k dispatch
 * events. The schemas moved to types.ts, beside the interfaces they mirror,
 * and are wired into the live handlers.
 *
 * The file is load-bearing even though the function was not: the live tools
 * import compilePack/renderPayload/lintOutput/runGolden and their input types
 * through the re-exports below. Deleting it breaks them at import time.
 */

export * from './types.js';
export { compilePack, loadCompiledPack, getOrCompilePack } from './compiler.js';
export { render, renderPayload } from './renderer.js';
export { lint, lintWithPack, lintOutput } from './linter.js';
export { runGoldenEval, updateGoldenFile, createGoldenCase, runGolden } from './golden.js';
