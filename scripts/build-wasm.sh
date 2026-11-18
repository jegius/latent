#!/usr/bin/env bash
# build-wasm.sh — сборка движка №2 (Rust-компилятор → WASM) для браузерной IDE.
#
# Проблема, которую решает скрипт: системный `cargo`/`rustc` из Homebrew не
# содержит `std` для `wasm32-unknown-unknown`, тогда как toolchain rustup — да.
# Скрипт явно выбирает rustup-инструменты и копирует артефакт в web-ide.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- 1. Находим rustup-тулчейн (у него есть wasm std) -----------------------
TOOLCHAIN_DIR="${RUSTUP_TOOLCHAIN_DIR:-$HOME/.rustup/toolchains/stable-aarch64-apple-darwin}"
if [ ! -x "$TOOLCHAIN_DIR/bin/cargo" ]; then
    # fallback: пробуем через rustup
    TOOLCHAIN_DIR="$(dirname "$(dirname "$(rustup which rustc 2>/dev/null || true)")")"
fi

if [ -x "$TOOLCHAIN_DIR/bin/cargo" ]; then
    CARGO="$TOOLCHAIN_DIR/bin/cargo"
    export RUSTC="$TOOLCHAIN_DIR/bin/rustc"
else
    CARGO="cargo"
fi

echo "Using cargo: $CARGO"
echo "Using rustc: ${RUSTC:-<default>}"

# --- 2. Проверяем наличие target -------------------------------------------
if ! "${RUSTC:-rustc}" --print target-list 2>/dev/null | grep -q wasm32-unknown-unknown; then
    echo "ERROR: rustc не знает про wasm32-unknown-unknown" >&2
    exit 1
fi

# --- 3. Собираем ------------------------------------------------------------
echo "Building compiler to wasm32-unknown-unknown (release)..."
"$CARGO" build --release --target wasm32-unknown-unknown

WASM="$ROOT/target/wasm32-unknown-unknown/release/latent.wasm"
if [ ! -f "$WASM" ]; then
    echo "ERROR: не найден $WASM" >&2
    exit 1
fi

# --- 4. Копируем в web-ide как compiler.wasm (движок №2) --------------------
cp "$WASM" "$ROOT/web-ide/compiler.wasm"
cp "$WASM" "$ROOT/web-ide/latent.wasm"
SIZE=$(wc -c < "$WASM" | tr -d ' ')
echo "OK: compiler.wasm = $SIZE bytes -> web-ide/"