#!/usr/bin/env node
// validate-examples.mjs — проверка всех ```latent-блоков в документации.
//
// Что делает:
//   1. Рекурсивно читает docs/docs/**/*.md (и .mdx).
//   2. Для каждого блока ```latent вызывает настоящий Rust-компилятор,
//      собранный в `web-ide/compiler.wasm`, через Node WebAssembly API
//      (ABI: latent_alloc / latent_compile / latent_free / latent_version —
//      см. src/lib.rs).
//   3. Обычный блок обязан скомпилироваться в ВАЛИДНЫЙ WASM-модуль.
//      WebAssembly.validate() дополнительно ловит невалидные модули, которые
//      кодогенератор иногда выдаёт вместо ошибки (например, float в массиве).
//
// Соглашение об «ожидаемо невалидных» блоках (host-фичи движка №1, каналы,
// AI, тензоры, а также случаи, когда кодогенератор №2 даёт невалидный WASM):
//   - в info-string блока есть `expected-error` / `не компилируется` / `ошибка`
//     / `host-only` (```latent expected-error), ИЛИ
//   - первая непустая строка блока — комментарий вида `// ошибка: ...`,
//     `// Не компилируется ...` или `// host-only ...`.
// Такой блок считается успешным, если компилятор вернул ошибку ИЛИ вернул
// невалидный WASM-модуль. Если он неожиданно скомпилировался в валидный
// WASM — это ошибка проверки (маркер устарел).
//
// Использование:
//   node docs/scripts/validate-examples.mjs [--root <repo>] [--verbose]
//
// Переменные окружения:
//   LATENT_COMPILER_WASM — путь к compiler.wasm (по умолчанию web-ide/compiler.wasm)
//   LATENT_DOCS_DIR      — каталог с markdown (по умолчанию docs/docs)
//
// Код выхода: 0 — все блоки соответствуют ожиданиям, 1 — есть расхождения.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = __dirname;

// ---------------------------------------------------------------------------
// Аргументы и пути
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
let repoRoot = resolve(SCRIPT_DIR, '..', '..');
let verbose = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root' && argv[i + 1]) {
    repoRoot = resolve(argv[++i]);
  } else if (argv[i] === '--verbose' || argv[i] === '-v') {
    verbose = true;
  } else if (argv[i] === '--help' || argv[i] === '-h') {
    console.log(
      'usage: node docs/scripts/validate-examples.mjs [--root <repo>] [--verbose]',
    );
    process.exit(0);
  }
}

const wasmPath =
  process.env.LATENT_COMPILER_WASM || join(repoRoot, 'web-ide', 'compiler.wasm');
const docsDir = process.env.LATENT_DOCS_DIR || join(repoRoot, 'docs', 'docs');

// ---------------------------------------------------------------------------
// Сбор markdown-файлов
// ---------------------------------------------------------------------------

/** @param {string} dir @returns {string[]} */
function walkMarkdown(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.') || entry === 'build') {
      continue;
    }
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkMarkdown(full));
    } else if (/\.mdx?$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Выделение ```latent-блоков
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LatentBlock
 * @property {string} file
 * @property {number} line       — номер строки открывающего ``` (1-based)
 * @property {string} meta       — info-string после слова latent
 * @property {string} code
 */

/**
 * @param {string} file
 * @param {string} text
 * @returns {LatentBlock[]}
 */
function extractLatentBlocks(file, text) {
  /** @type {LatentBlock[]} */
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const open = /^\s*```([A-Za-z0-9_+-]*)\s*(.*)$/.exec(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    const lang = (open[1] || '').toLowerCase();
    const meta = open[2] || '';
    const startLine = i + 1;
    const body = [];
    i++;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    // Пропускаем закрывающий ``` (если он есть; EOF-обрыв — тоже ошибка).
    i++;
    if (lang === 'latent') {
      blocks.push({file, line: startLine, meta, code: body.join('\n')});
    }
  }
  return blocks;
}

/** Маркер «ожидаемо невалидного» блока (русский и английский). */
function expectsError(block) {
  const meta = block.meta.trim().toLowerCase();
  if (
    /expected-error|не компилируется|ошибка|host-only|does not compile|doesn't compile|not compiled|expected error|invalid/.test(
      meta,
    )
  ) {
    return true;
  }
  const firstLine = block.code
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (!firstLine) return false;
  return /^\/\/\s*(ошибка|не компилируется|expected[- ]error|host-only|does not compile|doesn't compile|not compiled|invalid)/i.test(
    firstLine,
  );
}

// ---------------------------------------------------------------------------
// Загрузка движка №2 (Rust → WASM)
// ---------------------------------------------------------------------------

async function loadCompiler() {
  if (!existsSync(wasmPath)) {
    throw new Error(
      `компилятор не найден: ${wasmPath}\n` +
        'Соберите его: bash scripts/build-wasm.sh (нужен wasm32-unknown-unknown)',
    );
  }
  const bytes = readFileSync(wasmPath);
  const imports = {env: {print: () => {}}};
  const {instance} = await WebAssembly.instantiate(bytes, imports);
  const exports = instance.exports;
  if (typeof exports.latent_compile !== 'function' || !exports.memory) {
    throw new Error(
      'compiler.wasm не экспортирует ABI latent_compile/latent_alloc/latent_free',
    );
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /** @param {string} source @returns {Uint8Array} */
  function compile(source) {
    const enc = encoder.encode(source);
    const srcPtr = exports.latent_alloc(Math.max(enc.length, 1));
    if (enc.length) {
      new Uint8Array(exports.memory.buffer).set(enc, srcPtr);
    }
    const resPtr = exports.latent_compile(srcPtr, enc.length);
    const view = new DataView(exports.memory.buffer);
    const status = view.getUint32(resPtr, true);
    const len = view.getUint32(resPtr + 4, true);
    const payload = new Uint8Array(
      exports.memory.buffer,
      resPtr + 8,
      len,
    ).slice();
    try {
      exports.latent_free(srcPtr, Math.max(enc.length, 1));
    } catch {
      /* ignore */
    }
    try {
      exports.latent_free(resPtr, 8 + len);
    } catch {
      /* ignore */
    }
    if (status !== 1) {
      throw new Error(decoder.decode(payload));
    }
    return payload;
  }

  let version = 'latent-wasm';
  if (typeof exports.latent_version === 'function') {
    try {
      const vPtr = exports.latent_version();
      const view = new DataView(exports.memory.buffer);
      const vLen = view.getUint32(vPtr, true);
      version = decoder.decode(
        new Uint8Array(exports.memory.buffer, vPtr + 4, vLen),
      );
    } catch {
      /* ignore */
    }
  }
  return {compile, version};
}

// ---------------------------------------------------------------------------
// Основная проверка
// ---------------------------------------------------------------------------

function isWasm(bytes) {
  return (
    bytes &&
    bytes.length >= 8 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d
  );
}

/** @param {string[]} files */
async function main() {
  const files = walkMarkdown(docsDir);
  if (files.length === 0) {
    console.error(`нет markdown-файлов в ${docsDir}`);
    process.exit(1);
  }

  const compiler = await loadCompiler();
  console.log(`compiler: ${compiler.version} (${relative(repoRoot, wasmPath)})`);
  console.log(`docs:     ${relative(repoRoot, docsDir)} (${files.length} файлов)`);

  let total = 0;
  let validOk = 0;
  let expectedOk = 0;
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const staleMarkers = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const blocks = extractLatentBlocks(file, text);
    for (const block of blocks) {
      total++;
      const where = `${relative(repoRoot, file)}:${block.line}`;
      const expectErr = expectsError(block);
      let compiled;
      let compileError = null;
      try {
        compiled = compiler.compile(block.code);
      } catch (e) {
        compileError = e instanceof Error ? e.message : String(e);
      }

      const compiledOk =
        !compileError && isWasm(compiled) && WebAssembly.validate(compiled);

      if (expectErr) {
        if (!compiledOk) {
          expectedOk++;
          if (verbose) {
            console.log(
              `  ok (expected error) ${where}: ${
                compileError || 'вернулся невалидный WASM'
              }`,
            );
          }
        } else {
          staleMarkers.push(
            `${where}: блок помечен как невалидный, но скомпилировался в валидный WASM`,
          );
        }
        continue;
      }

      if (compiledOk) {
        validOk++;
        if (verbose) console.log(`  ok ${where}`);
      } else if (compileError) {
        failures.push(`${where}: ${compileError}`);
      } else if (!isWasm(compiled)) {
        failures.push(
          `${where}: компилятор вернул не-WASM данные (${compiled?.length ?? 0} байт)`,
        );
      } else {
        failures.push(
          `${where}: компилятор вернул WASM, не прошедший WebAssembly.validate()`,
        );
      }
    }
  }

  console.log('');
  console.log('всего блоков ```latent: ' + total);
  console.log(`  компилируются:        ${validOk}`);
  console.log(`  ожидаемо невалидны:   ${expectedOk}`);

  if (staleMarkers.length) {
    console.error('');
    console.error(`Устаревшие маркеры «ошибка» (${staleMarkers.length}):`);
    for (const s of staleMarkers) console.error(`  ✗ ${s}`);
  }
  if (failures.length) {
    console.error('');
    console.error(`Ошибки компиляции примеров (${failures.length}):`);
    for (const s of failures) console.error(`  ✗ ${s}`);
  }

  if (failures.length || staleMarkers.length) {
    console.error('');
    console.error('FAIL');
    process.exit(1);
  }

  console.log('');
  console.log('OK: все примеры соответствуют ожиданиям.');
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
