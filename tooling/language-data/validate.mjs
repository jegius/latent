// tooling/language-data/validate.mjs — CLI и публичный фасад валидатора.
//
// Нулевые зависимости: проверяет структуру `language.json` по
// `latent-language.schema.json` (без внешнего JSON Schema-движка), а также
// семантические инварианты, важные потребителям (LSP, IDE-плагины,
// MCP-сервер документации).
//
// Реализация — в validator.mjs (сам валидатор) и validator-*.mjs (правила).
//
// Запуск: node tooling/language-data/validate.mjs [путь к language.json]
// Код возврата: 0 — всё хорошо, 1 — есть ошибки.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateLanguageFile } from './validator.mjs';

export { validateLanguageData, validateLanguageFile } from './validator.mjs';
export { ENGINES, DOC_SECTIONS } from './validator-helpers.mjs';

const isMain = (() => {
    if (!process.argv[1]) return false;
    try {
        return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
    } catch (e) {
        return false;
    }
})();

if (isMain) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const target = process.argv[2] || path.join(here, 'language.json');
    const result = validateLanguageFile(target);
    for (const w of result.warnings) console.warn(`warning: ${w}`);
    for (const e of result.errors) console.error(`error: ${e}`);
    if (result.ok) {
        console.log(`OK: ${target}`);
        console.log(`  keywords=${result.stats.keywords} operators=${result.stats.operators} ` +
            `types=${result.stats.types} builtins=${result.stats.builtins} ` +
            `diagnostics=${result.stats.diagnostics} snippets=${result.stats.snippets ?? 0}`);
    } else {
        console.error(`FAIL: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    }
    process.exit(result.ok ? 0 : 1);
}
