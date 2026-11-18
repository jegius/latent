---
title: "Web calculator: a Latent core and a JS interface"
sidebar_label: "Calculator"
sidebar_position: 10
description: "Walkthrough of a web calculator: recursive expression parsing in Latent, two ways of passing an expression — a constant in the source and on-the-fly compilation through compiler.wasm."
---

# Web calculator: a Latent core and a JS interface

This case shows how to separate responsibilities: **parsing and evaluating an
expression** is done by the Latent module, while the input, the buttons, and the
output are plain JS. Along the way we look at the main ABI limitation: `main()`
takes no arguments, so the expression has to be either hard-coded into the source
or compiled on the fly in the browser.

## How it works

| Layer | What it does | Where |
|---|---|---|
| Latent core | recursive parsing of `+ - * /`, parentheses, unary minus; returns `int` | `.lat` → `.wasm` |
| ABI | `env.print` for messages, `main() -> i32` as the result | guide, §2 |
| UI | `<input>`, buttons, output, error highlighting | HTML/CSS/JS |

The core knows nothing about the DOM and does not read input: it receives an
**expression string**. From there, three paths are possible, and this case shows
the first two:

- **A. A constant in the source.** The expression is written in the `.lat` file,
  the module is compiled for it, and JS calls `main()`.
- **B. Compilation on the fly.** JS substitutes the entered expression into the
  source and compiles it with the browser compiler `compiler.wasm`.
- **C. A `main` parameter.** `fn main(expr: string)` plus a pointer to the string
  in memory — shorter, but it relies on the informal passing of parameters
  ([guide, §2.3](../guide/web-and-frontend.md#23-main-signature)).

## The core: recursive expression parsing

The grammar is the classic one:

```text
expr   := term (('+' | '-') term)*
term   := factor (('*' | '/') factor)*
factor := number | '(' expr ')' | '-' factor
```

A string in Latent is `[len][utf8]` and `s[i]` returns a byte, so the characters
are compared against ASCII codes: `43` `+`, `45` `-`, `42` `*`, `47` `/`, `40` `(`,
`41` `)`, `32` space. Errors are collected in the array `err[0]`: `1` — syntax,
`2` — division by zero. The language has no exceptions, so this is the only way to
return a "soft" error.

```latent
// The calculator core: recursive parsing of arithmetic.
// Error: err[0] = 1 (syntax) or 2 (division by 0).

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
    let expr = "1 + 1"; // variant A changes this line; variant B substitutes it from JS
    let value = evaluate(expr);
    print("value:", value);
    return value;
}
```

Worth noting here:

- `parse_expr` is called from `parse_factor` before its own declaration — the
  signatures of top-level functions are collected in advance, so mutual recursion
  works.
- `pos` and `err` are single-element arrays playing the role of mutable variables:
  the language has no `&mut`, and an array is mutated in place.
- `0 - parse_factor(...)`: unary `-x` exists in the language, but here subtraction
  from zero is used so that the parsing rule stays uniform.
- `err[0] = 2` for division by zero is checked **before** the division:
  `i32.div_s` on zero traps instead of raising an exception.

## Variant A: the expression is hard-coded into the source

The simplest and most predictable path: one expression — one `.wasm`.

1. Replace `let expr = "1 + 1";` with the expression you need, for example
   `let expr = "2 + 3 * (4 - 1)";`.
2. Compile:

```bash
./target/debug/latentc compile calculator.lat calculator.wasm
```

3. Load the module and call `main()`:

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

**What you will see** for `"2 + 3 * (4 - 1)"`:

```
value:
11
```

and the number `11` in the `<output>` element. `print("value:", value)` calls
`env.print` twice, which is why the log has two lines.

Plus: no browser compiler, minimal code, a module of ~2.3 KB.
Minus: a new expression means a new compilation (on the server or in CI).

## Variant B: compilation on the fly in the browser

Here the Latent compiler itself is loaded into the browser — `compiler.wasm`
(465,435 bytes). It exports the C ABI `latent_alloc`/`latent_compile`/`latent_free`
(see [WASM ABI](../reference/wasm-abi.md#compiler-c-abi-engine-2-in-the-browser)).

The scheme:

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

Save the “Core” block above as `public/calculator.lat` (do not touch the
placeholder `let expr = "1 + 1";` — JS will replace it).

```js
// calculator-runner.js — compiling and running an expression in the browser.
const COMPILER_URL = '/compiler.wasm'; // put it next to index.html
const SOURCE_URL = '/calculator.lat';

let compilerPromise = null;
let sourcePromise = null;
const moduleCache = new Map();

function loadCompiler() {
  compilerPromise ??= (async () => {
    const response = await fetch(COMPILER_URL);
    if (!response.ok) throw new Error(`compiler.wasm: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    // The compiler has no imports: {}
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
    // payload — UTF-8 text of the compiler error (Russian)
    throw new Error(new TextDecoder().decode(payload));
  }
  return payload;
}

async function runExpression(expression) {
  // The calculator accepts only ASCII digits and operators: that also protects
  // the string from quotes and line breaks when it is substituted into the source.
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

// --- minimal UI ---
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

**What you will see:**

| Input | `lines` | `value` |
|---|---|---|
| `2 + 3 * (4 - 1)` | `value:`, `11` | `11` |
| `100 / 7` | `value:`, `14` | `14` (integer division) |
| `10 / 0` | `error: division by zero`, `value:`, `-1` | `-1` |
| `2 + * 3` | `error: invalid expression`, `value:`, `-1` | `-1` |

Note that `-1` is both a valid result and the error code. For a real UI it is
better to return two values (a flag and a number) or a string with a message.

## Limitations of the case

- **Only `int`.** Fractional division is not supported: `7 / 2` = `3`. The numbers
  are 32-bit, and overflow wraps around.
- **ASCII only.** The parser compares bytes; Cyrillic in an expression is not
  recognized (and is not supposed to be).
- **No `**`, `%`, variables, unary `+`** or functions: the grammar is deliberately
  small.
- **No exceptions.** An error is `-1` plus a line in `print`; a trap (for example
  on overflow of `INT_MIN / -1`) is caught by JS as a `WebAssembly.RuntimeError`.
- **`main()` without arguments in variants A and B.** Variant C
  (`main(expr: string)`) requires passing a string pointer and only works in its
  own host — see the [guide](../guide/web-and-frontend.md#23-main-signature).
- **The on-the-fly compiler means ~465 KB and a compilation per input.** The
  `WebAssembly.Module` cache keyed by the source smooths out repeated runs, but
  the first one is noticeable. For production, variants A/C are usually better.

## Things to try

1. Add `%` (code `37`) to the parser, along with a division-by-zero check for it.
2. Make unary `+` work so that `+5` is not treated as an error.
3. Return a string with the result from `main` and print it without `<output>`.
4. Compare the behavior with engine #1 in the playground: there `7 / 2` gives
   `3.5`.

## Related sections

- [Latent in the frontend](../guide/web-and-frontend.md) — the ABI, memory, patterns.
- [WASM ABI](../reference/wasm-abi.md) — the format of the compiler's response.
- [Strings](../examples/frontend-strings.md) — how JS writes `[len][utf8]`.
- [Your own playground](../examples/frontend-compiler-playground.md) — the same
  ABI, but with an editor and running arbitrary code.
