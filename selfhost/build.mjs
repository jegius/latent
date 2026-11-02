// Сборщик self-hosted компилятора Latent.
//
// Язык Latent компилируется одним файлом и не имеет системы модулей, поэтому
// «линковка» здесь — детерминированная конкатенация частей в порядке имён.
// Каждая часть (selfhost/src/NN_*.lat) отвечает за одну обязанность (SRP):
//
//   00_abi.lat              — карта линейной памяти и доступ к слотам состояния;
//   10_buffer.lat           — байтовые буферы и кодирование LEB128;
//   20_lexer.lat            — исходник → параллельные массивы токенов;
//   30_syntax.lat           — курсор токенов, локальные, таблицы имён и строк;
//   35_class.lat, 36_lambda.lat — регистрация классов/enum и лямбд/захватов;
//   40a..40g_expr_*.lat     — эмиссия выражений (Pratt) и инструкций-call;
//   45a..45d_tc_*.lat       — тайп-чекер (ядро, выражения, поток, программа);
//   50_stmt.lat             — эмиссия инструкций (let/if/while/for/return/assign);
//   60_func.lat             — сборка одного тела функции;
//   70a..70c_module_*.lat   — хелперы, конверсии и секции WASM-модуля;
//   90_driver.lat           — точка входа: полный проход компиляции.
//
// Порядок частей детерминирован (сортировка имён), сборка идемпотентна:
// один и тот же набор частей всегда даёт байт-в-байт одинаковый shc.lat.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    // Нормализуем переводы строк к LF: сборка обязана быть байт-в-байт
    // одинаковой на Windows (CRLF-чекаут) и Unix. Иначе shc.lat, собранный
    // на разных ОС, различается, а вместе с ним и WASM на выходе.
    const text = readFileSync(join(SRC_DIR, name), "utf8")
      .replace(/\r\n?/g, "\n")
      .replace(/\s+$/, "");
    return `// ===== часть: ${name} =====\n${text}\n`;
  });
  return BANNER + chunks.join("\n");
}

// Точка входа: сравниваем URL-формы, а не строки путей. На Windows
// `file://C:\...` не равно `file:///C:/...`, из-за чего сборка молча
// не запускалась (и shc.lat не обновлялся).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const source = assemble();
  writeFileSync(OUT, source, "utf8");
  console.log(`shc.lat собран из ${listParts().length} частей -> ${OUT} (${Buffer.byteLength(source, "utf8")} байт)`);
}
