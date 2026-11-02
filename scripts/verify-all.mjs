#!/usr/bin/env node
// Полная верификация репозитория Latent одной командой.
//
// Запускает все проверки по очереди и печатает сводку. Код выхода 1, если
// хотя бы одна обязательная проверка упала. Проверки, требующие собранного
// `latentc` (Rust), помечаются SKIP, если бинаря нет (например, на чистом
// checkout без cargo build), — их выполняет CI.
//
// Использование:
//   node scripts/verify-all.mjs                 # все быстрые проверки
//   node scripts/verify-all.mjs --docs-build    # + сборка Docusaurus (долго)
//   node scripts/verify-all.mjs --golden        # + golden-WASM (нужен latentc)
//   node scripts/verify-all.mjs --coverage      # + JS-покрытие web-ide и MCP

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;
const args = new Set(process.argv.slice(2));

const results = [];
let failed = 0;

function run(name, command, options = {}) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${name}\n  $ ${command}\n`);
  const res = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  if (out) {
    const lines = out.split(/\r?\n/);
    const tail = lines.slice(-(options.tailLines ?? 12)).join("\n");
    console.log(tail.split("\n").map((l) => `  ${l}`).join("\n"));
  }
  const ok = res.status === 0;
  if (!ok) failed += 1;
  results.push({ name, ok, ms, status: res.status });
  console.log(`  → ${ok ? "OK" : "FAIL"} (${(ms / 1000).toFixed(1)} s)`);
  return ok;
}

function skip(name, reason) {
  results.push({ name, ok: true, skipped: true, reason });
  console.log(`\n⏭ ${name}: SKIP — ${reason}`);
}

const latentc = process.platform === "win32"
  ? join(ROOT, "target", "debug", "latentc.exe")
  : join(ROOT, "target", "debug", "latentc");
const hasLatentc = existsSync(latentc);
const env = hasLatentc ? { LATENTC: latentc } : {};

// --- Self-hosted компилятор -------------------------------------------------
run("selfhost: сборка shc.lat", `"${NODE}" selfhost/build.mjs`);
if (hasLatentc) {
  run("selfhost: bootstrap (fixed point)", `"${NODE}" selfhost/bootstrap.mjs`);
} else {
  skip("selfhost: bootstrap (fixed point)", "нет target/debug/latentc — соберите: cargo build --bin latentc");
}
run("selfhost: регресс-тесты", `"${NODE}" --test selfhost/test/*.test.mjs`, { env });

// --- web IDE ----------------------------------------------------------------
run("web-ide: тесты", `"${NODE}" --test web-ide/test/*.test.js`, { tailLines: 6 });
run("web-ide: структурный аудит", `"${NODE}" web-ide/scripts/check-structure.mjs`);

// --- tooling ----------------------------------------------------------------
run("language-data: валидация", `"${NODE}" tooling/language-data/validate.mjs`);
run("LSP: тесты", `"${NODE}" --test tooling/latent-lsp/test/*.test.mjs`, { tailLines: 6 });
run("MCP: тесты", `"${NODE}" --test mcp/docs-mcp/test/*.test.mjs`, { tailLines: 6 });

// --- редакторы --------------------------------------------------------------
run("VS Code: тесты", `"${NODE}" --test editors/vscode/test/*.test.mjs`, { tailLines: 6 });

// --- документация -----------------------------------------------------------
run("docs: проверка примеров", `"${NODE}" docs/scripts/validate-examples.mjs`, { tailLines: 8 });
if (args.has("--docs-build")) {
  // pnpm задаётся LATENT_PNPM (путь к pnpm.mjs) или ищется в PATH.
  const pnpm = process.env.LATENT_PNPM || "pnpm";
  run("docs: сборка Docusaurus", `cd docs && "${NODE}" "${pnpm}" run build`, { tailLines: 10 });
}

// --- опциональные тяжёлые проверки -----------------------------------------
if (args.has("--golden")) {
  if (hasLatentc) run("Rust: golden WASM", `"${NODE}" scripts/check-golden.mjs`, { tailLines: 8 });
  else skip("Rust: golden WASM", "нет target/debug/latentc");
}
if (args.has("--coverage")) {
  run("web-ide: покрытие", `"${NODE}" --experimental-test-coverage --test web-ide/test/*.test.js`, { tailLines: 4 });
  run("MCP: покрытие", `"${NODE}" --experimental-test-coverage --test mcp/docs-mcp/test/*.test.mjs`, { tailLines: 4 });
}

// --- сводка -----------------------------------------------------------------
console.log("\n=== СВОДКА ===");
for (const r of results) {
  if (r.skipped) console.log(`  ⏭ ${r.name} — ${r.reason}`);
  else console.log(`  ${r.ok ? "✔" : "✖"} ${r.name} (${(r.ms / 1000).toFixed(1)} s)`);
}
const ran = results.filter((r) => !r.skipped).length;
console.log(`\nИтого: ${ran - failed}/${ran} проверок прошло${failed ? `, ПРОВАЛОВ: ${failed}` : ""}.`);
process.exit(failed === 0 ? 0 : 1);
