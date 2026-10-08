// compiler/index.js — barrel-агрегатор публичного API компилятора Latent.
// Единственная ответственность: реэкспорт всех модулей движка №1, AI и движка №2.

export { TokenType, KEYWORDS, SOFT_KEYWORDS } from './token.js';
export { tokenize } from './lexer.js';
export { Parser } from './parser.js';
export {
    ReturnSignal, Channel, Environment,
    resolvedPromise, isPromise, taggedValue, isTagged,
} from './environment.js';
export { Interpreter } from './interpreter.js';
export { Instance, isInstance, findMethod } from './oop.js';
export {
    Tensor, isTensor, inferShape, flatTensor, cosineSimilarity, matmul,
} from './value-utils.js';
export {
    AIConfig, configureAI, getAIConfig,
    clearAICache, getAICacheSize, persistentAICache, aiCacheKey,
} from './ai-config.js';
export { checkAIGateway, aiInferRemote } from './ai-gateway.js';
export { analyzeCode, countSelfCalls } from './analysis.js';
export {
    repairCode, extractCode, deterministicRepair, collectAIPrompts,
} from './repair.js';
export { loadWasmCompiler } from './wasm-loader.js';
export { loadCompiler, compile, checkSyntax, getVersion } from './loader.js';
export { runLatent } from './run.js';