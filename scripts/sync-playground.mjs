#!/usr/bin/env node
// Синхронизация web IDE в статику сайта документации.
//
// Единственная ответственность: скопировать статические файлы `web-ide/` в
// `docs/static/playground/`, откуда Docusaurus отдаёт их по адресу
// `<baseUrl>/playground/` (на GitHub Pages — /latent/playground/).
//
// Playground НЕ коммитится в git (см. .gitignore): он собирается из
// единственного источника правды — каталога web-ide/ — перед сборкой сайта.
//
// Использование:
//   node scripts/sync-playground.mjs            # скопировать
//   node scripts/sync-playground.mjs --clean    # удалить playground
//   node scripts/sync-playground.mjs --check    # только проверить наличие

import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "web-ide");
const DST = join(ROOT, "docs", "static", "playground");

// Всё, что не нужно в опубликованной IDE: тесты, метаданные пакета, README.
const EXCLUDE_DIRS = new Set(["node_modules", "test", ".git"]);
const EXCLUDE_FILES = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json", "README.md"]);

/** Рекурсивно копирует web-ide → docs/static/playground с фильтрацией. */
function sync() {
  if (!existsSync(SRC)) {
    console.error(`[sync-playground] нет каталога ${SRC}`);
    process.exit(1);
  }
  rmSync(DST, { recursive: true, force: true });
  mkdirSync(DST, { recursive: true });

  cpSync(SRC, DST, {
    recursive: true,
    filter: (path) => {
      const parts = path.slice(SRC.length).split(/[\\/]/).filter(Boolean);
      if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
      const base = parts[parts.length - 1] ?? "";
      return !EXCLUDE_FILES.has(base);
    },
  });

  const count = countFiles(DST);
  console.log(`[sync-playground] web-ide → ${DST} (${count} файлов)`);
}

/** Проверяет, что playground собран и web IDE там есть. */
function check() {
  const index = join(DST, "index.html");
  const wasm = join(DST, "compiler.wasm");
  const ok = existsSync(index) && existsSync(wasm);
  console.log(
    ok
      ? `[sync-playground] OK: ${DST} готов (index.html + compiler.wasm)`
      : `[sync-playground] playground не собран: ${index} / ${wasm}`,
  );
  return ok;
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

const arg = process.argv[2];
if (arg === "--clean") {
  rmSync(DST, { recursive: true, force: true });
  console.log(`[sync-playground] удалён ${DST}`);
} else if (arg === "--check") {
  process.exit(check() ? 0 : 1);
} else {
  sync();
}
