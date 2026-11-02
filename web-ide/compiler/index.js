// compiler/index.js — barrel-агрегатор публичного API компилятора Latent.
// Единственная ответственность: реэкспорт всех модулей движка №1, AI и движка №2.
//
// Тяжёлые части подключаются лениво: AI-провайдеры и self-repair — через
// `lazy-ai.js` (dynamic import при первом использовании), движок №2 — через
// `loader.js` (dynamic import wasm-loader при первом использовании). Стартовый
// граф содержит только интерпретатор, парсер, лексер и чистые помощники.

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
export { checkAIGateway, aiInferRemote } from './lazy-ai.js';
export { analyzeCode, countSelfCalls } from './analysis.js';
export { extractCode, deterministicRepair, collectAIPrompts } from './repair-core.js';
export { repairCode } from './lazy-ai.js';
export {
    detectHostFeatures, detectAIFeatures, isHostRuntimeError,
    describeFeatures, explainEngine2HostLimit,
    ENGINE1_LABEL, ENGINE2_LABEL,
} from './host-features.js';
export { loadWasmCompiler } from './loader.js';
export { loadCompiler, compile, checkSyntax, getVersion } from './loader.js';
export { runLatent } from './run.js';
