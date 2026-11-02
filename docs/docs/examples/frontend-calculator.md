---
title: "Веб-калькулятор: Latent-ядро и JS-интерфейс"
sidebar_label: "Калькулятор"
sidebar_position: 10
description: "Разбор веб-калькулятора: рекурсивный разбор выражений на Latent, два способа передать выражение — константа в исходнике и компиляция на лету через compiler.wasm."
---

# Веб-калькулятор: Latent-ядро и JS-интерфейс

Кейс показывает, как разделить ответственность: **разбор и вычисление
выражения** делает Latent-модуль, а ввод, кнопки и вывод — обычный JS. Заодно
разбираем главное ограничение ABI: `main()` не принимает аргументов, поэтому
выражение нужно либо зашить в исходник, либо скомпилировать модуль на лету в
браузере.

## Как это устроено

| Слой | Что делает | Где |
|---|---|---|
| Ядро Latent | рекурсивный разбор `+ - * /`, скобок, унарного минуса; возвращает `int` | `.lat` → `.wasm` |
| ABI | `env.print` для сообщений, `main() -> i32` как результат | §2 гайда |
| UI | `<input>`, кнопки, вывод, подсветка ошибок | HTML/CSS/JS |

Ядро не знает про DOM и не читает ввод: оно получает **строку-выражение**.
Дальше возможны три пути, и в этом кейсе показаны первые два:

- **А. Константа в исходнике.** Выражение записано в `.lat`, модуль
  компилируется под него, JS вызывает `main()`.
- **Б. Компиляция на лету.** JS подставляет введённое выражение в исходник и
  компилирует его браузерным компилятором `compiler.wasm`.
- **В. Параметр `main`.** `fn main(expr: string)` и указатель на строку в
  памяти — короче, но опирается на неформальную передачу параметров
  ([гайд, §2.3](../guide/web-and-frontend.md#23-сигнатура-main)).

## Ядро: рекурсивный разбор выражений

Грамматика классическая:

```text
expr   := term (('+' | '-') term)*
term   := factor (('*' | '/') factor)*
factor := number | '(' expr ')' | '-' factor
```

Строка в Latent — `[len][utf8]`, `s[i]` возвращает байт, поэтому символы
сравниваются с ASCII-кодами: `43` `+`, `45` `-`, `42` `*`, `47` `/`, `40` `(`,
`41` `)`, `32` пробел. Ошибки складываются в массив `err[0]`: `1` — синтаксис,
`2` — деление на ноль. Исключений в языке нет, поэтому это единственный способ
вернуть «мягкую» ошибку.

```latent
// Ядро калькулятора: рекурсивный разбор арифметики.
// Ошибка: err[0] = 1 (синтаксис) или 2 (деление на 0).

fn skip_spaces(s: string, pos: [int]) {
    while (pos[0] < s.length) {
        if (s[pos[0]] != 32) {
            return;
        }
        pos[0] = pos[0] + 1;
    }
}

fn parse_number(s: string, pos: [int]) -> int {
    let n = 0;
    while (pos[0] < s.length) {
        let c = s[pos[0]];
        if (c < 48 || c > 57) {
            return n;
        }
        n = n * 10 + (c - 48);
        pos[0] = pos[0] + 1;
    }
    return n;
}

fn parse_factor(s: string, pos: [int], err: [int]) -> int {
    skip_spaces(s, pos);
    if (pos[0] >= s.length) {
        err[0] = 1;
        return 0;
    }
    let c = s[pos[0]];
    if (c == 40) {
        pos[0] = pos[0] + 1;
        let v = parse_expr(s, pos, err);
        skip_spaces(s, pos);
        if (pos[0] < s.length && s[pos[0]] == 41) {
            pos[0] = pos[0] + 1;
        } else {
            err[0] = 1;
        }
        return v;
    }
    if (c == 45) {
        pos[0] = pos[0] + 1;
        return 0 - parse_factor(s, pos, err);
    }
    if (c >= 48 && c <= 57) {
        return parse_number(s, pos);
    }
    err[0] = 1;
    return 0;
}

fn parse_term(s: string, pos: [int], err: [int]) -> int {
    let v = parse_factor(s, pos, err);
    while (err[0] == 0) {
        skip_spaces(s, pos);
        if (pos[0] >= s.length) {
            return v;
        }
        let c = s[pos[0]];
        if (c != 42 && c != 47) {
            return v;
        }
        pos[0] = pos[0] + 1;
        let rhs = parse_factor(s, pos, err);
        if (c == 42) {
            v = v * rhs;
        } else {
            if (rhs == 0) {
                err[0] = 2;
                return 0;
            }
            v = v / rhs;
        }
    }
    return v;
}

fn parse_expr(s: string, pos: [int], err: [int]) -> int {
    let v = parse_term(s, pos, err);
    while (err[0] == 0) {
        skip_spaces(s, pos);
        if (pos[0] >= s.length) {
            return v;
        }
        let c = s[pos[0]];
        if (c != 43 && c != 45) {
            return v;
        }
        pos[0] = pos[0] + 1;
        let rhs = parse_term(s, pos, err);
        if (c == 43) {
            v = v + rhs;
        } else {
            v = v - rhs;
        }
    }
    return v;
}

fn evaluate(src: string) -> int {
    let pos = [0];
    let err = [0];
    let v = parse_expr(src, pos, err);
    skip_spaces(src, pos);
    if (err[0] == 2) {
        print("error: division by zero");
        return -1;
    }
    if (err[0] != 0 || pos[0] != src.length) {
        print("error: invalid expression");
        return -1;
    }
    return v;
}

fn main() -> int {
    let expr = "1 + 1"; // эту строку меняет вариант А; вариант Б подставляет её из JS
    let value = evaluate(expr);
    print("value:", value);
    return value;
}
```

Что здесь стоит заметить:

- `parse_expr` вызывается из `parse_factor` до своего объявления — сигнатуры
  верхнеуровневых функций собираются заранее, взаимная рекурсия работает.
- `pos` и `err` — массивы из одного элемента, играющие роль изменяемых
  переменных: в языке нет `&mut`, а массив мутируется на месте.
- `0 - parse_factor(...)`: унарный `-x` в языке есть, но здесь используется
  вычитание из нуля, чтобы правило разбора было единым.
- `err[0] = 2` при делении на ноль проверяется **до** деления: `i32.div_s` на
  нуле даёт trap, а не исключение.

## Вариант А: выражение зашито в исходник

Самый простой и самый предсказуемый путь: одно выражение — один `.wasm`.

1. Замените `let expr = "1 + 1";` на нужное выражение, например
   `let expr = "2 + 3 * (4 - 1)";`.
2. Скомпилируйте:

```bash
./target/debug/latentc compile calculator.lat calculator.wasm
```

3. Загрузите модуль и вызовите `main()`:

```html
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8" /><title>Калькулятор</title></head>
<body>
  <output id="result">…</output>
  <pre id="log"></pre>

  <script type="module">
    const logEl = document.getElementById('log');
    const resultEl = document.getElementById('result');

    function readString(memory, ptr) {
      const view = new DataView(memory.buffer);
      const len = view.getUint32(ptr, true);
      return new TextDecoder().decode(
        new Uint8Array(memory.buffer, ptr + 4, len),
      );
    }

    let instance;
    const imports = {
      env: {
        print(ptr) {
          logEl.textContent += readString(instance.exports.memory, ptr) + '\n';
        },
      },
    };

    const bytes = await (await fetch('./calculator.wasm')).arrayBuffer();
    ({instance} = await WebAssembly.instantiate(bytes, imports));

    const value = instance.exports.main();
    resultEl.textContent = String(value);
  </script>
</body>
</html>
```

**Что вы увидите** для `"2 + 3 * (4 - 1)"`:

```
value:
11
```

и число `11` в `<output>`. `print("value:", value)` вызывает `env.print`
дважды, поэтому в логе две строки.

Плюс: нет браузерного компилятора, минимум кода, модуль ~2,3 КБ.
Минус: новое выражение — новая компиляция (на сервере или в CI).

## Вариант Б: компиляция на лету в браузере

Здесь в браузер загружается сам компилятор Latent — `compiler.wasm` (465 435
байт). Он экспортирует C-ABI `latent_alloc`/`latent_compile`/`latent_free`
(см. [WASM ABI](../reference/wasm-abi.md#c-abi-компилятора-движок-2-в-браузере)).

Схема:

```
public/calculator.lat ──fetch──▶ JS
                                  │ replace('let expr = "..."')
                                  ▼
                          latent_compile(ptr, len)
                                  │ [status][len][payload]
                                  ▼
                        WebAssembly.instantiate(payload)
                                  │
                                  ▼
                            main() → i32
```

Сохраните блок «Ядро» выше как `public/calculator.lat` (плейсхолдер
`let expr = "1 + 1";` не трогайте — его заменит JS).

```js
// calculator-runner.js — компиляция и запуск выражения в браузере.
const COMPILER_URL = '/compiler.wasm'; // положите рядом с index.html
const SOURCE_URL = '/calculator.lat';

let compilerPromise = null;
let sourcePromise = null;
const moduleCache = new Map();

function loadCompiler() {
  compilerPromise ??= (async () => {
    const response = await fetch(COMPILER_URL);
    if (!response.ok) throw new Error(`compiler.wasm: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    // У компилятора нет импортов: {}
    const {instance} = await WebAssembly.instantiate(bytes, {});
    return instance.exports;
  })();
  return compilerPromise;
}

function loadSource() {
  sourcePromise ??= fetch(SOURCE_URL).then((response) => {
    if (!response.ok) throw new Error(`calculator.lat: HTTP ${response.status}`);
    return response.text();
  });
  return sourcePromise;
}

function compile(compiler, source) {
  const encoded = new TextEncoder().encode(source);
  const srcPtr = compiler.latent_alloc(Math.max(encoded.length, 1));
  new Uint8Array(compiler.memory.buffer).set(encoded, srcPtr);

  const resPtr = compiler.latent_compile(srcPtr, encoded.length);
  const view = new DataView(compiler.memory.buffer);
  const status = view.getUint32(resPtr, true);
  const len = view.getUint32(resPtr + 4, true);
  const payload = new Uint8Array(compiler.memory.buffer, resPtr + 8, len).slice();

  compiler.latent_free(srcPtr, Math.max(encoded.length, 1));
  compiler.latent_free(resPtr, 8 + len);

  if (status !== 1) {
    // payload — UTF-8 текст ошибки компилятора (русский)
    throw new Error(new TextDecoder().decode(payload));
  }
  return payload;
}

async function runExpression(expression) {
  // Калькулятор принимает только ASCII-цифры и операторы: это же защищает
  // строку от кавычек и переводов строк при подстановке в исходник.
  if (!/^[0-9+\-*/() ]+$/.test(expression)) {
    throw new Error('допустимы только цифры, пробелы и + - * / ( )');
  }

  const [compiler, template] = await Promise.all([loadCompiler(), loadSource()]);
  const source = template.replace(
    /let expr = "[^"]*";/,
    `let expr = "${expression}";`,
  );

  let module = moduleCache.get(source);
  if (!module) {
    const wasm = compile(compiler, source);
    module = await WebAssembly.compile(wasm);
    moduleCache.set(source, module);
  }

  let instance;
  const lines = [];
  const imports = {
    env: {
      print(ptr) {
        const memory = instance.exports.memory;
        const view = new DataView(memory.buffer);
        const len = view.getUint32(ptr, true);
        lines.push(
          new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len)),
        );
      },
    },
  };
  instance = await WebAssembly.instantiate(module, imports);

  const value = instance.exports.main();
  return {value, lines};
}

// --- минимальный UI ---
const input = document.querySelector('#expr');
const button = document.querySelector('#calc');
const output = document.querySelector('#result');
const logEl = document.querySelector('#log');

button.addEventListener('click', async () => {
  output.textContent = '…';
  logEl.textContent = '';
  try {
    const {value, lines} = await runExpression(input.value);
    logEl.textContent = lines.join('\n');
    output.textContent = String(value);
  } catch (error) {
    output.textContent = 'ошибка';
    logEl.textContent = error.message;
  }
});
```

```html
<input id="expr" value="2 + 3 * (4 - 1)" size="40" />
<button id="calc">Вычислить</button>
<output id="result">…</output>
<pre id="log"></pre>
```

**Что вы увидите:**

| Ввод | `lines` | `value` |
|---|---|---|
| `2 + 3 * (4 - 1)` | `value:`, `11` | `11` |
| `100 / 7` | `value:`, `14` | `14` (целочисленное деление) |
| `10 / 0` | `error: division by zero`, `value:`, `-1` | `-1` |
| `2 + * 3` | `error: invalid expression`, `value:`, `-1` | `-1` |

Обратите внимание: `-1` — и корректный результат, и код ошибки. Для настоящего
UI лучше вернуть два значения (флаг и число) или строку с сообщением.

## Ограничения кейса

- **Только `int`.** Деления дробные не поддерживаются: `7 / 2` = `3`. Числа —
  32-битные, переполнение заворачивается.
- **Только ASCII.** Парсер сравнивает байты; кириллица в выражении не
  распознается (и не должна).
- **Нет `**`, `%`, переменных, унарного `+`** и функций: грамматика намеренно
  маленькая.
- **Нет исключений.** Ошибка — это `-1` плюс строка в `print`; trap (например,
  при переполнении `INT_MIN / -1`) JS ловит как `WebAssembly.RuntimeError`.
- **`main()` без аргументов в вариантах А и Б.** Вариант В (`main(expr:
  string)`) требует передать указатель на строку и работает только в своём
  хосте — см. [гайд](../guide/web-and-frontend.md#23-сигнатура-main).
- **Компилятор на лету — это ~465 КБ и компиляция на каждый ввод.** Кэш
  `WebAssembly.Module` по исходнику сглаживает повторные запуски, но первый
  раз заметен. Для продакшена вариант А/В обычно лучше.

## Что попробовать

1. Добавьте в парсер `%` (код `37`) и проверку деления на ноль для него.
2. Сделайте унарный `+`, чтобы `+5` не считался ошибкой.
3. Верните из `main` строку с результатом и выведите её без `<output>`.
4. Сравните поведение с движком №1 в playground: `7 / 2` там даст `3.5`.

## Связанные разделы

- [Latent во фронтенде](../guide/web-and-frontend.md) — ABI, память, паттерны.
- [WASM ABI](../reference/wasm-abi.md) — формат ответа компилятора.
- [Строки](../examples/frontend-strings.md) — как JS пишет `[len][utf8]`.
- [Свой playground](../examples/frontend-compiler-playground.md) — тот же ABI,
  но с редактором и запуском произвольного кода.
