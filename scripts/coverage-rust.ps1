#!/usr/bin/env pwsh
# coverage-rust.ps1 — покрытие строк Rust-компилятора Latent (llvm-cov).
#
# Зачем отдельный скрипт: на Windows-gnu в этом окружении rust-std не содержит
# `libprofiler_builtins`, поэтому `cargo llvm-cov` падает с E0463/E0461. Скрипт:
#   1) если стандартный путь работает — вызывает `cargo llvm-cov`;
#   2) иначе собирает тесты вручную с `-C instrument-coverage` и линкует
#      профилировочный runtime через lld (GNU ld на Windows некорректно
#      размещает секции `.lcov*`, из-за чего exe получается невалидным);
#   3) сливает .profraw через llvm-profdata и печатает отчёт llvm-cov.
#
# Требования для fallback (Windows-gnu):
#   * MinGW в PATH;
#   * `COV_PROFILER_RT` — путь к статической библиотеке profiler runtime
#     (собирается из compiler-rt, см. docs/docs/specs/rust-architecture.md);
#   * в sysroot лежит rlib `libprofiler_builtins-*.rlib`, собранный с
#     `#![profiler_runtime]` (скрипт создаёт заглушку автоматически, если её нет);
#   * cargo-llvm-cov не обязателен.
#
# Примеры:
#   pwsh scripts/coverage-rust.ps1
#   $env:COV_PROFILER_RT="C:\tools\libprofiler_rt.a"; pwsh scripts/coverage-rust.ps1 -Threshold 90
param(
    [string]$Toolchain = "stable-x86_64-pc-windows-gnu",
    [string]$TargetDir = "target/coverage",
    [int]$Threshold = 90,
    [string]$IgnoreRegex = '(tests|bin[\\/]|\.cargo|\.rustup|/rustc/)'
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$exe = if ($IsWindows) { ".exe" } else { "" }
$cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo$exe"
if (-not (Test-Path $cargo)) { $cargo = "cargo" }
if ($IsWindows) { $env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Users\Admin\tools\mingw\mingw64\bin;$env:PATH" }

$sysroot = & $cargo "+$Toolchain" rustc --print sysroot
$hostTriple = (& $cargo "+$Toolchain" -Vv | Select-String '^host:').ToString().Split(':')[1].Trim()
$toolsBin = Join-Path $sysroot "lib\rustlib\$hostTriple\bin"
$profdata = Join-Path $toolsBin "llvm-profdata$exe"
$llvmcov = Join-Path $toolsBin "llvm-cov$exe"
$profiler = Get-ChildItem (Join-Path $sysroot "lib\rustlib\$hostTriple\lib") -Filter 'libprofiler_builtins-*' -ErrorAction SilentlyContinue | Select-Object -First 1

# --- Вариант 1: штатный cargo-llvm-cov (Linux/macOS; Windows с полным rust-std) --
if ($profiler -and -not $env:COV_PROFILER_RT) {
    Write-Host "[coverage] используется cargo llvm-cov" -ForegroundColor Cyan
    & $cargo "+$Toolchain" llvm-cov --all-targets --summary-only --ignore-filename-regex $IgnoreRegex
    exit $LASTEXITCODE
}

if (-not $env:COV_PROFILER_RT) {
    Write-Error @"
Нет profiler runtime: `cargo llvm-cov` не может работать, а COV_PROFILER_RT не задан.
Соберите libprofiler_rt.a из compiler-rt (см. rust-architecture.md, раздел «Покрытие»)
и повторите:  `$env:COV_PROFILER_RT="<путь>\libprofiler_rt.a"; pwsh scripts/coverage-rust.ps1
"@
}

# --- Вариант 2: ручная инструментация + lld -----------------------------------
Write-Host "[coverage] ручной режим: instrument-coverage + lld + $env:COV_PROFILER_RT" -ForegroundColor Cyan

# lld под именем ld.lld, чтобы gcc-драйвер нашёл его через -fuse-ld=lld.
$lldDir = Join-Path ([IO.Path]::GetTempPath()) "latent-cov-lld"
New-Item -ItemType Directory -Force $lldDir | Out-Null
$lldSrc = Join-Path $sysroot "lib\rustlib\$hostTriple\bin\rust-lld$exe"
Copy-Item $lldSrc (Join-Path $lldDir "ld.lld$exe") -Force
$env:PATH = "$lldDir;$env:PATH"

# rlib-заглушка `profiler_builtins` (rustc требует именно её метаданные).
$libDir = Join-Path $sysroot "lib\rustlib\$hostTriple\lib"
if (-not (Get-ChildItem $libDir -Filter 'libprofiler_builtins-*' -ErrorAction SilentlyContinue)) {
    $stub = Join-Path ([IO.Path]::GetTempPath()) "latent-profiler-stub.rs"
    @'
#![feature(profiler_runtime)]
#![no_std]
#![allow(internal_features)]
#![profiler_runtime]
'@ | Set-Content -Path $stub -Encoding utf8
    $rustc = Join-Path $sysroot "bin\rustc$exe"
    $env:RUSTC_BOOTSTRAP = "1"
    & $rustc --crate-name profiler_builtins --crate-type rlib --target $hostTriple -O $stub `
        -o (Join-Path $libDir "libprofiler_builtins-cov.rlib")
}

$td = Join-Path $repo $TargetDir
Remove-Item $td -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $td | Out-Null

$env:RUSTC_BOOTSTRAP = "1"
$env:RUSTFLAGS = "-C instrument-coverage -C link-arg=-fuse-ld=lld " +
    "-C link-arg=$env:COV_PROFILER_RT -C link-arg=-lkernel32 -C link-arg=-lmsvcrt " +
    "-C link-arg=-Wl,--allow-multiple-definition -C link-arg=-Wl,--no-gc-sections"
$env:LLVM_PROFILE_FILE = Join-Path $td "prof-%p-%m.profraw"

$log = Join-Path $td "cargo-test.log"
& $cargo "+$Toolchain" test --all-targets --target-dir $td *> $log
if ($LASTEXITCODE -ne 0) { Get-Content $log | Select-Object -Last 30; exit $LASTEXITCODE }

$profraw = Get-ChildItem $td -Filter "*.profraw" -ErrorAction SilentlyContinue
if (-not $profraw) { Write-Error "не создано ни одного .profraw — инструментация не сработала" }
$profdataFile = Join-Path $td "coverage.profdata"
& $profdata merge -sparse $profraw.FullName -o $profdataFile
if ($LASTEXITCODE -ne 0) { Write-Error "llvm-profdata merge failed" }

$objects = @(Get-ChildItem (Join-Path $td "debug\deps") -Filter "latent-*$exe" |
    Where-Object { $_.Name -notmatch 'latentc' } | ForEach-Object { "-object=$($_.FullName)" })
$report = & $llvmcov report @objects "-instr-profile=$profdataFile" "--ignore-filename-regex=$IgnoreRegex"
$report | Write-Output
$total = ($report | Select-String '^TOTAL\s+' | Select-Object -Last 1).ToString()
$linePct = if ($total -match '([0-9]+\.[0-9]+)%\s+[0-9]+\s+[0-9]+\s+[0-9.]+%\s*$') { [double]$Matches[1] } else { 0 }
Write-Host "[coverage] TOTAL: $total" -ForegroundColor Green
if ($linePct -lt $Threshold) {
    Write-Error "покрытие строк $linePct% ниже порога $Threshold%"
}
