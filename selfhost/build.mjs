// Сборщик self-hosted компилятора Latent.
//
// Язык Latent компилируется одним файлом и не имеет системы модулей, поэтому
// «линковка» здесь — детерминированная конкатенация частей в порядке имён.
// Каждая часть (selfhost/src/NN_*.lat) отвечает за одну обязанность (SRP):
//
//   00_abi.lat       — карта линейной памяти и доступ к слотам состояния;
//   10_buffer.lat    — байтовые буферы и кодирование LEB128;
//   20_lexer.lat     — исходник → параллельные массивы токенов;
//   30_syntax.lat    — курсор токенов, локальные, таблицы имён и строк;
//   40_emit_expr.lat — эмиссия выражений (Pratt) и инструкций-call;
//   50_stmt.lat      — эмиссия инструкций (let/if/while/for/return/assign);
//   60_func.lat      — сборка одного тела функции;
//   70_module.lat    — сборка секций WASM-модуля;
//   90_driver.lat    — точка входа: полный проход компиляции.
//
// Порядок частей детерминирован (сортировка имён), сборка идемпотентна:
// один и тот же набор частей всегда даёт байт-в-байт одинаковый shc.lat.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "src");
const OUT = join(HERE, "shc.lat");

const BANNER =
  "// СГЕНЕРИРОВАНО selfhost/build.mjs из selfhost/src/*.lat — не редактировать вручную.\n" +
  "// Пересобрать: node selfhost/build.mjs\n\n";

/** Список частей в детерминированном порядке. */
export function listParts() {
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".lat"))
    .sort();
}

/** Собирает исходник компилятора из частей. Идемпотентно. */
export function assemble() {
  const parts = listParts();
  const chunks = parts.map((name) => {
    const text = readFileSync(join(SRC_DIR, name), "utf8").replace(/\s+$/, "");
    return `// ===== часть: ${name} =====\n${text}\n`;
  });
  return BANNER + chunks.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = assemble();
  writeFileSync(OUT, source, "utf8");
  console.log(`shc.lat собран из ${listParts().length} частей -> ${OUT} (${source.length} байт)`);
}