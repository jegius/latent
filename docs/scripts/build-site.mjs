#!/usr/bin/env node
// build-site.mjs — запуск `docusaurus build` с защитой от Windows-флака.
//
// Зачем: на Windows при сборке НЕСКОЛЬКИХ локалей (ru + en) webpack пишет
// build/<locale>/__server/server.bundle.js, а Docusaurus сразу же его читает.
// Антивирус/индексатор иногда успевает залочить только что созданный файл —
// сборка падает с ENOENT `server.bundle.js`, хотя файл уже на месте. Повторный
// запуск обычно успешен. Этот враппер распознаёт ИМЕННО эту ошибку и повторяет
// сборку (до 3 попыток), не скрывая остальные ошибки.
//
// Используется из docs/package.json:
//   "build": "node scripts/build-llms.mjs && node scripts/build-site.mjs"

import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const docusaurusCli = require.resolve('@docusaurus/core/bin/docusaurus.mjs');

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @returns {Promise<{code: number, output: string}>} */
function runBuild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [docusaurusCli, 'build', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const forward = (stream, chunk) => {
      stream.write(chunk);
      output += chunk.toString('utf8');
      // Не держим в памяти мегабайты лога.
      if (output.length > 400_000) output = output.slice(-200_000);
    };
    child.stdout.on('data', (chunk) => forward(process.stdout, chunk));
    child.stderr.on('data', (chunk) => forward(process.stderr, chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({code: code ?? 1, output}));
  });
}

const args = process.argv.slice(2);
/** Признак известного Windows-флака: ENOENT на server.bundle.js. */
const isServerBundleRace = (output) =>
  /ENOENT/.test(output) && /server\.bundle\.js/.test(output);

let lastCode = 1;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const {code, output} = await runBuild(args);
  if (code === 0) {
    process.exit(0);
  }
  lastCode = code;
  if (attempt < MAX_ATTEMPTS && isServerBundleRace(output)) {
    console.warn(
      `\n[build-site] Попытка ${attempt}/${MAX_ATTEMPTS}: ENOENT server.bundle.js ` +
        '(известный флак файловой системы Windows) — повтор через ' +
        `${RETRY_DELAY_MS} мс...\n`,
    );
    await sleep(RETRY_DELAY_MS);
    continue;
  }
  process.exit(code);
}
process.exit(lastCode);
