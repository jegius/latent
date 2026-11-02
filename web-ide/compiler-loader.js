// compiler-loader.js — barrel-фасад компилятора Latent для браузера.
//
// Весь код разнесён по `compiler/` по зонам ответственности:
//   token.js, lexer.js, parser.js, environment.js, interpreter*.js,
//   ai-config.js, ai-gateway.js, analysis.js, repair.js, wasm-loader.js,
//   loader.js, run.js — и агрегируется в compiler/index.js.
//
// Этот файл сохранён как тонкий реэкспорт: тесты и сервисы импортируют
// движок №1, AI-функции и движок №2 строго из './compiler-loader.js'.
// Здесь нет собственной логики — только реэкспорт публичного API.

export {
    // Лексер/парсер
    TokenType, tokenize, Parser,
    // Runtime-примитивы
    ReturnSignal, Channel, Environment, Interpreter,
    // AI-конфигурация и гейтвей
    configureAI, getAIConfig, clearAICache, getAICacheSize, checkAIGateway,
    // Анализ и ремонт
    analyzeCode, analyzeProject, repairCode, extractCode, deterministicRepair,
    // Определение host-фич и метки движков
    detectHostFeatures, detectAIFeatures, isHostRuntimeError,
    describeFeatures, explainEngine2HostLimit, ENGINE1_LABEL, ENGINE2_LABEL,
    // Загрузчики движков
    loadCompiler, compile, checkSyntax, getVersion, loadWasmCompiler,
    // Запуск программы (однофайловой и многофайловой)
    runLatent, runLatentProject, linkModuleProject, clearLinkedModuleCache,
    // Резолвер модулей и манифест LPF1 для движка №2
    ModuleError, normalizeModulePath, resolveImportPath, resolveModuleGraph,
    sourceHasModuleSyntax, ModuleCache, sharedModuleCache,
    MANIFEST_MAGIC, buildModuleManifest, encodeModuleManifest,
    decodeModuleManifest, projectHash,
} from './compiler/index.js';