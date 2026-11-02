#!/usr/bin/env node
// check-golden.mjs — регрессия поведения Rust-компилятора Latent.
//
// Зачем: любая декомпозиция/рефакторинг `src/**` обязана сохранять
// БАЙТ-В-БАЙТ тот же WASM на фиксированном наборе программ (и те же тексты
// ошибок). Скрипт:
//
//   1. компилирует golden-набор через `latentc compile` и сверяет SHA-256
//      результата (или точный текст ошибки) с `scripts/golden/expected.json`;
//   2. прогоняет поведенческие проверки: для фикстур с `// expect-main: N`
//      инстанцирует WASM в Node и сверяет возврат `main()`; для фикстур с
//      `// expect-error: ...` проверяет, что текст ошибки содержит подстроку;
//   3. дополнительно хэширует web-ide/examples/*.lat и selfhost/shc.lat.
//
// Использование:
//   node scripts/check-golden.mjs            # проверка (exit 1 при расхождении)
//   node scripts/check-golden.mjs --update   # перезаписать эталон
//   node scripts/check-golden.mjs --quiet    # только итог
//
// Компилятор ищется в $LATENTC, затем в target/debug/latentc(.exe),
// target/release/latentc(.exe). WASM исполняется тем же Node, что запустил
// скрипт (WebAssembly + Crypto — stdlib, зависимостей нет).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const GOLDEN_DIR = join(HERE, 'golden');
const FIXTURES = join(GOLDEN_DIR, 'fixtures');
const EXPECTED_FILE = join(GOLDEN_DIR, 'expected.json');
// Многофайловые fixtures для selfhost-паритета: entry помечен `// entry: true`.
const MODULE_FIXTURES = join(ROOT, 'selfhost', 'test', 'fixtures', 'modules');

const argv = new Set(process.argv.slice(2));
const UPDATE = argv.has('--update');
const STRICT = argv.has('--strict');
const QUIET = argv.has('--quiet');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rel = (path) => relative(ROOT, path).split(sep).join('/');
const log = (...args) => { if (!QUIET) console.log(...args); };

// --- поиск latentc ---------------------------------------------------------

function findLatentc() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const candidates = [
    process.env.LATENTC,
    join(ROOT, 'target', 'debug', `latentc${exe}`),
    join(ROOT, 'target', 'release', `latentc${exe}`),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(
    'latentc не найден. Соберите `cargo build --bin latentc` или задайте LATENTC=<path>.',
  );
  process.exit(2);
}

const LATENTC = findLatentc();

// --- discovery -------------------------------------------------------------

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith('.lat')) out.push(path);
  }
  return out;
}

/** Программы, для которых хранится эталон (фикстуры + примеры + shc). */
function programs() {
  const list = walk(FIXTURES);
  const examples = walk(join(ROOT, 'web-ide', 'examples'));
  list.push(...examples);
  const shc = join(ROOT, 'selfhost', 'shc.lat');
  if (existsSync(shc)) list.push(shc);
  return list;
}

// --- компиляция ------------------------------------------------------------

/** Компилирует файл; возвращает { wasm, error }. */
function compileFile(path) {
  const tmp = join(process.env.TEMP || process.env.TMPDIR || '/tmp', `latent-golden-${process.pid}.wasm`);
  try {
    execFileSync(LATENTC, ['compile', path, tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    const wasm = readFileSync(tmp);
    return { wasm, error: null };
  } catch (e) {
    const stderr = (e.stderr || Buffer.alloc(0)).toString('utf8').trim();
    const message = stderr.replace(/^error:\s*/, '');
    return { wasm: null, error: message || String(e.message) };
  }
}

const sha256File = (path) => sha256(readFileSync(path));

function entryFor(path) {
  const kind = rel(path).startsWith('web-ide/') ? 'example'
    : rel(path) === 'selfhost/shc.lat' ? 'shc' : 'fixture';
  const { wasm, error } = compileFile(path);
  if (kind === 'shc') {
    // selfhost/shc.lat генерируется selfhost-агентом и меняется независимо:
    // сверяем только при совпадении исходника, иначе честно сообщаем skip.
    return { kind, sourceSha256: sha256File(path), sha256: wasm && sha256(wasm), size: wasm && wasm.length, error };
  }
  if (wasm) return { kind, sha256: sha256(wasm), size: wasm.length };
  return { kind, error };
}

// --- поведенческие проверки ------------------------------------------------

function annotation(text, name) {
  const m = text.match(new RegExp(`^//\\s*${name}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

function runMain(path) {
  const { wasm, error } = compileFile(path);
  if (!wasm) throw new Error(`компиляция не удалась: ${error}`);
  const imports = { env: { print: () => {} } };
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), imports);
  const main = instance.exports.main;
  if (typeof main !== 'function') throw new Error('модуль не экспортирует main');
  return main();
}

function behaviorChecks() {
  const failures = [];
  let checked = 0;
  for (const path of walk(FIXTURES)) {
    const text = readFileSync(path, 'utf8');
    const expectMain = annotation(text, 'expect-main');
    const expectError = annotation(text, 'expect-error');
    if (expectMain === null && expectError === null) continue;
    checked += 1;
    try {
      if (expectError !== null) {
        const { error } = compileFile(path);
        if (!error) failures.push(`${rel(path)}: ожидалась ошибка «${expectError}», но компиляция успешна`);
        else if (!error.includes(expectError)) {
          failures.push(`${rel(path)}: в ошибке нет «${expectError}»: ${error}`);
        }
        continue;
      }
      const actual = runMain(path);
      const expected = Number(expectMain);
      if (actual !== expected) {
        failures.push(`${rel(path)}: main() = ${actual}, ожидалось ${expected}`);
      }
    } catch (e) {
      failures.push(`${rel(path)}: ${e.message}`);
    }
  }
  return { checked, failures };
}

// --- дифференциальный тест модулей ----------------------------------------

/** Запускает latentc; возвращает { ok, error }. */
function runLatentc(args) {
  try {
    execFileSync(LATENTC, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, error: null };
  } catch (e) {
    const stderr = (e.stderr || Buffer.alloc(0)).toString('utf8').trim();
    return { ok: false, error: stderr.replace(/^error:\s*/, '') || String(e.message) };
  }
}

/**
 * Fixtures `selfhost/test/fixtures/modules/**`:
 *   entry помечается `// entry: true`;
 *   `// expect-main: N` — проверить возврат main();
 *   `// expect-error: ...` — ожидается ошибка компиляции с подстрокой.
 * Для успешных entry: compile_files(entry) == compile(bundle) байт-в-байт.
 */
function moduleChecks() {
  const failures = [];
  let checked = 0;
  for (const path of walk(MODULE_FIXTURES)) {
    const text = readFileSync(path, 'utf8');
    if (annotation(text, 'entry') !== 'true') continue;
    checked += 1;
    const expectError = annotation(text, 'expect-error');
    const dir = mkdtempSync(join(tmpdir(), 'latent-modules-'));
    try {
      if (expectError !== null) {
        const res = runLatentc(['compile', path, join(dir, 'out.wasm')]);
        if (res.ok) {
          failures.push(`${rel(path)}: ожидалась ошибка «${expectError}», но компиляция успешна`);
        } else if (!res.error.includes(expectError)) {
          failures.push(`${rel(path)}: в ошибке нет «${expectError}»: ${res.error}`);
        }
        continue;
      }

      const directWasm = join(dir, 'direct.wasm');
      const bundlePath = join(dir, 'bundle.lat');
      const bundledWasm = join(dir, 'bundle.wasm');

      const direct = runLatentc(['compile', path, directWasm]);
      if (!direct.ok) { failures.push(`${rel(path)}: compile_files: ${direct.error}`); continue; }
      const bundled = runLatentc(['bundle', path, bundlePath]);
      if (!bundled.ok) { failures.push(`${rel(path)}: bundle: ${bundled.error}`); continue; }
      const fromBundle = runLatentc(['compile', bundlePath, bundledWasm]);
      if (!fromBundle.ok) { failures.push(`${rel(path)}: compile(bundle): ${fromBundle.error}`); continue; }

      const a = readFileSync(directWasm);
      const b = readFileSync(bundledWasm);
      if (!a.equals(b)) {
        failures.push(`${rel(path)}: compile_files != compile(bundle) (${a.length} vs ${b.length} bytes)`);
      }

      const expectMain = annotation(text, 'expect-main');
      if (expectMain !== null) {
        try {
          const instance = new WebAssembly.Instance(
            new WebAssembly.Module(a),
            { env: { print: () => {} } },
          );
          const actual = instance.exports.main();
          if (actual !== Number(expectMain)) {
            failures.push(`${rel(path)}: main() = ${actual}, ожидалось ${expectMain}`);
          }
        } catch (e) {
          failures.push(`${rel(path)}: запуск main: ${e.message}`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { checked, failures };
}

// --- основные режимы -------------------------------------------------------

function buildExpected() {
  const entries = {};
  for (const path of programs()) entries[rel(path)] = entryFor(path);
  return { version: 1, generatedBy: 'scripts/check-golden.mjs', entries };
}

function compare() {
  if (!existsSync(EXPECTED_FILE)) {
    console.error(`Нет эталона ${rel(EXPECTED_FILE)}. Запустите: node scripts/check-golden.mjs --update`);
    return 2;
  }
  const expected = JSON.parse(readFileSync(EXPECTED_FILE, 'utf8')).entries;
  const failures = [];
  let compared = 0;
  let skipped = 0;
  for (const path of programs()) {
    const key = rel(path);
    const want = expected[key];
    if (!want) { failures.push(`${key}: нет в эталоне (--update)`); continue; }
    const got = entryFor(path);
    if (want.kind === 'shc' && got.sourceSha256 !== want.sourceSha256) {
      skipped += 1;
      log(`SKIP ${key}: исходник изменился с момента эталона (selfhost-агент)`);
      continue;
    }
    compared += 1;
    const fields = want.error !== undefined
      ? ['error']
      : ['sha256', 'size'];
    for (const f of fields) {
      if (got[f] !== want[f]) {
        failures.push(`${key}: ${f} отличается (эталон ${want[f]}, сейчас ${got[f]})`);
      }
    }
  }
  return { failures, compared, skipped };
}

function main() {
  log(`latentc: ${rel(LATENTC)}`);
  const behavior = behaviorChecks();
  log(`Поведенческих проверок: ${behavior.checked}, провалов: ${behavior.failures.length}`);
  for (const f of behavior.failures) console.error(`  FAIL ${f}`);

  const modules = moduleChecks();
  log(`Модульных fixtures: ${modules.checked}, провалов: ${modules.failures.length}`);
  for (const f of modules.failures) console.error(`  FAIL ${f}`);

  if (UPDATE) {
    const data = buildExpected();
    writeFileSync(EXPECTED_FILE, JSON.stringify(data, null, 2) + '\n');
    const total = Object.keys(data.entries).length;
    console.log(`Эталон обновлён: ${rel(EXPECTED_FILE)} (${total} программ)`);
    process.exit(behavior.failures.length === 0 && modules.failures.length === 0 ? 0 : 1);
  }

  const result = compare();
  if (result === 2) process.exit(2);
  const { failures, compared, skipped } = result;
  // --strict: SKIP считается провалом (в CI эталон обязан быть свежим,
  // иначе изменение shc.lat могло бы скрыть регресс компилятора).
  if (STRICT && skipped > 0) {
    failures.push(`${skipped} программ(ы) пропущены (SKIP) — обновите эталон: node scripts/check-golden.mjs --update`);
  }
  console.log(
    `Golden-сверка: ${compared} программ совпало, расхождений ${failures.length}` +
      (skipped ? `, пропущено ${skipped} (shc.lat изменён)` : ''),
  );
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(
    failures.length === 0 && behavior.failures.length === 0 && modules.failures.length === 0
      ? 0
      : 1,
  );
}

main();
