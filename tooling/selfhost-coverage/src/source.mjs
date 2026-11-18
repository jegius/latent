// Загрузка исходника компилятора: готовый shc.lat или сборка из частей.
//
// Сборка повторяет selfhost/build.mjs (детерминированная конкатенация с
// сортировкой имён), но не импортирует его: инструмент должен работать даже
// если build.mjs временно сломан параллельной правкой.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const BANNER =
  "// СГЕНЕРИРОВАНО selfhost/build.mjs из selfhost/src/*.lat — не редактировать вручную.\n" +
  "// Пересобрать: node selfhost/build.mjs\n\n";

export function listParts(srcDir) {
  return readdirSync(srcDir)
    .filter((f) => f.endsWith(".lat"))
    .sort();
}

/** Собирает shc.lat из частей; байт-в-байт как selfhost/build.mjs. */
export function assembleParts(srcDir) {
  const parts = listParts(srcDir);
  const chunks = parts.map((name) => {
    const text = readFileSync(join(srcDir, name), "utf8")
      .replace(/\r\n?/g, "\n")
      .replace(/\s+$/, "");
    return `// ===== часть: ${name} =====\n${text}\n`;
  });
  return { source: BANNER + chunks.join("\n"), parts };
}

/**
 * @param {{shc?:string, src?:string, repoRoot?:string}} opts
 * @returns {{source:string, path:string, parts:string[], mode:"shc"|"src"}}
 */
export function loadCompilerSource(opts) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  if (opts.src) {
    const dir = opts.src;
    if (!existsSync(dir)) throw new Error(`selfhost-coverage: нет каталога --src ${dir}`);
    const { source, parts } = assembleParts(dir);
    return { source, path: dir, parts, mode: "src" };
  }
  const path = opts.shc ?? join(repoRoot, "selfhost", "shc.lat");
  if (!existsSync(path)) throw new Error(`selfhost-coverage: нет файла --shc ${path}`);
  return { source: readFileSync(path, "utf8"), path, parts: [], mode: "shc" };
}
