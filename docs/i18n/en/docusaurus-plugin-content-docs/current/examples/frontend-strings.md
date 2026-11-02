---
title: "Strings in the browser: `[len][utf8]`"
sidebar_label: "Strings and UTF-8"
sidebar_position: 12
description: "The Latent string format [len u32][utf8], passing a string from JS, reading the result back, byte length and indexing, and handling raw bytes through load8."
---

# Strings in the browser: `[len][utf8]`

Strings are the most common source of mistakes on the JS/Latent boundary: in JS a
string lives in UTF-16 and is measured in code units, while in Latent it is
`[len u32][utf8]` in linear memory and `length` counts **bytes**. This case shows
the complete cycle: JS wrote a string → Latent processed it → JS read the result.

## Format

```text
address → +0  length in UTF-8 bytes (u32 LE)
          +4  UTF-8 bytes
```

- The string pointer points at the length, not at the first byte.
- `s.length` and `len(s)` return the length in bytes.
- `s[i]` returns a byte `0..255`, not a character.
- `+` concatenates, `==` compares the contents, `<`/`>` compare pointers.

## The core: a greeting and byte counting

```latent
fn repeat(s: string, n: int) -> string {
    let out = "";
    let i = 0;
    while (i < n) {
        out = out + s;
        i = i + 1;
    }
    return out;
}

fn count_byte(s: string, code: int) -> int {
    let n = 0;
    let i = 0;
    while (i < s.length) {
        if (s[i] == code) {
            n = n + 1;
        }
        i = i + 1;
    }
    return n;
}

fn main(name: string) -> string {
    let greeting = "Привет, " + name + "!";
    print(repeat("-", 24));
    print("bytes:", greeting.length);
    print("letters t:", count_byte(name, 116));
    print("first byte:", greeting[0]);
    return greeting;
}
```

- `name: string` is an `i32` pointer; JS passes it into `main`.
- `"Привет, "` is a UTF-8 literal: 6 Cyrillic characters = 12 bytes.
- `count_byte(name, 116)` counts the Latin `t` (ASCII code 116); for Cyrillic one
  character takes two bytes, so a search "by character" like this will not work.
- `greeting[0]` is the first **byte** of UTF-8, `208` (`0xD0`) for `П`.
- What comes back is a pointer to a new string on the heap; JS reads it as
  `[len][utf8]`.

## The JS host

```js
const NAME_ADDR = 16;

function ensureCapacity(memory, endByte) {
  const needPages = Math.ceil(endByte / 65536);
  const havePages = memory.buffer.byteLength / 65536;
  if (needPages > havePages) memory.grow(needPages - havePages);
}

function writeString(memory, addr, text) {
  const bytes = new TextEncoder().encode(text); // UTF-8, not UTF-16
  ensureCapacity(memory, addr + 4 + bytes.length);
  new DataView(memory.buffer).setUint32(addr, bytes.length, true);
  new Uint8Array(memory.buffer).set(bytes, addr + 4);
  return addr;
}

function readString(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len));
}

let instance;
const log = document.querySelector('#log');
const imports = {
  env: {
    print(ptr) {
      log.textContent += readString(instance.exports.memory, ptr) + '\n';
    },
  },
};

const bytes = await (await fetch('./strings.wasm')).arrayBuffer();
({instance} = await WebAssembly.instantiate(bytes, imports));

const memory = instance.exports.memory;
writeString(memory, NAME_ADDR, 'Latent');

const greetingPtr = instance.exports.main(NAME_ADDR);
const greeting = readString(memory, greetingPtr);

document.querySelector('#result').textContent = greeting;
document.querySelector('#bytes').textContent =
  `${new TextEncoder().encode(greeting).length} байт / ${greeting.length} JS code units`;
```

**What you will see:**

```
------------------------
Привет, Latent!
bytes:
21
letters t:
2
first byte:
208
```

In the `<output>` element you get `Привет, Latent!`, and next to it
`21 байт / 15 JS code units`. The 21-versus-15 discrepancy is exactly why you
cannot trust `str.length` at the WASM boundary.

## Handling raw bytes without `main` parameters

If a string has to be processed byte by byte and the `main` signature cannot
change, use `load32`/`load8`: JS writes the length at address `16` and the bytes
starting at `20`, and the module reads them as numbers.

```latent
fn main() -> int {
    let n = load32(16);
    let vowels = 0;
    let i = 0;
    while (i < n) {
        let b = load8(20 + i);
        if (b == 97 || b == 101 || b == 105 || b == 111 || b == 117) {
            vowels = vowels + 1;
        }
        i = i + 1;
    }
    print("bytes:", n);
    print("vowels:", vowels);
    return vowels;
}
```

```js
const text = 'hello latent';
const bytes = new TextEncoder().encode(text);
const view = new DataView(memory.buffer);
view.setUint32(16, bytes.length, true);
new Uint8Array(memory.buffer).set(bytes, 20);

const vowels = instance.exports.main(); // 4
```

Only the ASCII vowels are counted here (`a e i o u`, codes `97 101 105 111 117`).
For UTF-8 this is an honestly byte-wise operation: the Cyrillic `а` is two bytes,
`208 176`, and neither of them equals `97`.

**What you will see:** `bytes:`, `12`, `vowels:`, `4`.

## What you cannot do (and why)

- **Build a string from bytes in Latent.** There is no "string from a buffer"
  builtin: `alloc` + `store8` give you a pointer, but you cannot make the `string`
  type out of it. So an input string is either a literal in the source, a pointer
  from JS, or processed byte by byte.
- **Take a substring, split, or change case.** There is no `substring`, `split`,
  or `upper`. All of that happens in JS or manually, through bytes and
  concatenation.
- **Compare strings with `<`/`>`.** Those operators compare pointers, not
  contents; for equality there is `==`.
- **Store a `float` in a string without formatting.** `str(1.5)` gives
  `"1.500000"` (six digits after the point) — that is the helper's format, not a
  universal one.

## Limitations and pitfalls

- **O(n²) on concatenation in a loop.** `out = out + s` allocates a new string
  every time; for long texts, build a byte array and allocate once.
- **Memory is never freed.** Every concatenation and every `str()` grows the heap.
- **`s[i]` is a byte, not a character.** Indexing into Cyrillic gives you half a
  character.
- **Escaping.** Only `\n`, `\t`, `\\`, `\"` are supported in literals; `\r`,
  `\0`, `\u{...}` are compile errors. When you substitute a user string into
  source code, escape `\` and `"`.
- **BOM.** Save `.lat` files without a BOM — otherwise the lexer fails.
- **`print` is the only output channel.** It receives a string; returning a string
  from `main` is more efficient when there are many strings.

## Things to try

1. Write `count_byte` for a Cyrillic letter: count the byte `208` (the first byte
   of many letters) and explain why that is not the number of letters.
2. Write `starts_with(s, prefix)` using a byte-by-byte comparison.
3. Build a string from 1000 fragments and compare the time with a single
   `repeat`.
4. Pass a string with an emoji (4 UTF-8 bytes) into `main` and check `length`.

## Related sections

- [Latent in the frontend](../guide/web-and-frontend.md) — strings and arrays in
  the ABI.
- [Arrays and strings](../guide/arrays-and-strings.md) — the language.
- [WASM ABI](../reference/wasm-abi.md#string) — the exact layout.
- [Data and arrays](./frontend-data-processing.md) · [Calculator](./frontend-calculator.md).
