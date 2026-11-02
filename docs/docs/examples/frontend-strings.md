---
title: "Строки в браузере: `[len][utf8]` и JS"
sidebar_label: "Строки и UTF-8"
sidebar_position: 12
description: "Формат строки Latent [len u32][utf8], передача строки из JS, чтение результата, байтовая длина и индексация, обработка сырых байтов через load8."
---

# Строки в браузере: `[len][utf8]`

Строки — самый частый источник ошибок на границе JS и Latent: в JS строка
живёт в UTF-16 и измеряется в code units, в Latent — это `[len u32][utf8]` в
линейной памяти, и `length` считает **байты**. Этот кейс показывает полный
цикл: JS записал строку → Latent посчитал → JS прочитал результат.

## Формат

```text
адрес → +0  длина в байтах UTF-8 (u32 LE)
        +4  байты UTF-8
```

- Указатель строки — на длину, а не на первый байт.
- `s.length` и `len(s)` возвращают длину в байтах.
- `s[i]` возвращает байт `0..255`, а не символ.
- `+` конкатенирует, `==` сравнивает содержимое, `<`/`>` — указатели.

## Ядро: приветствие и подсчёт байтов

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

- `name: string` — это `i32`-указатель; JS передаёт его в `main`.
- `"Привет, "` — литерал в UTF-8: 6 кириллических символов = 12 байт.
- `count_byte(name, 116)` считает латинские `t` (ASCII-код 116); для кириллицы
  один символ занимает два байта, и такой поиск по «символу» не сработает.
- `greeting[0]` — первый **байт** UTF-8, `208` (`0xD0`) для `П`.
- Возвращается указатель на новую строку в куче; JS читает её как `[len][utf8]`.

## JS-хост

```js
const NAME_ADDR = 16;

function ensureCapacity(memory, endByte) {
  const needPages = Math.ceil(endByte / 65536);
  const havePages = memory.buffer.byteLength / 65536;
  if (needPages > havePages) memory.grow(needPages - havePages);
}

function writeString(memory, addr, text) {
  const bytes = new TextEncoder().encode(text); // UTF-8, не UTF-16
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

**Что вы увидите:**

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

В `<output>` — `Привет, Latent!`, рядом — `21 байт / 15 JS code units`.
Расхождение 21 против 15 — ровно то, из-за чего нельзя доверять `str.length`
на границе с WASM.

## Обработка сырых байтов без параметров `main`

Если строку нужно обработать по байтам, а менять сигнатуру `main` нельзя,
используйте `load32`/`load8`: JS пишет длину по адресу `16`, байты — с `20`,
модуль читает их как числа.

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

Здесь считаются только ASCII-гласные (`a e i o u`, коды `97 101 105 111 117`).
Для UTF-8 это честно байтовая операция: кириллическая `а` — два байта
`208 176`, и ни один из них не равен `97`.

**Что вы увидите:** `bytes:`, `12`, `vowels:`, `4`.

## Чего нельзя сделать (и почему)

- **Собрать строку из байтов в Latent.** Нет builtin «строка из буфера»:
  `alloc` + `store8` дают указатель, но тип `string` из него не сделать.
  Поэтому входная строка либо литерал в исходнике, либо указатель от JS,
  либо обработка по байтам.
- **Взять подстроку/разбить/привести регистр.** Нет `substring`, `split`,
  `upper`. Всё это — в JS или вручную через байты и конкатенацию.
- **Сравнивать строки через `<`/`>`.** Эти операторы сравнивают указатели,
  а не содержимое; для равенства есть `==`.
- **Хранить `float` в строке без форматирования.** `str(1.5)` даёт
  `"1.500000"` (шесть знаков после точки) — это формат хелпера, а не
  универсальный.

## Ограничения и подводные камни

- **O(n²) на конкатенации в цикле.** `out = out + s` каждый раз выделяет новую
  строку; для длинных текстов собирайте массив байтов и одно выделение.
- **Память не освобождается.** Каждая конкатенация и `str()` увеличивают кучу.
- **`s[i]` — байт, а не символ.** Индексация по кириллице даст половину
  символа.
- **Экранирование.** В литералах поддерживаются только `\n`, `\t`, `\\`,
  `\"`; `\r`, `\0`, `\u{...}` — ошибка компиляции. При подстановке
  пользовательской строки в исходник экранируйте `\` и `"`.
- **BOM.** Файлы `.lat` сохраняйте без BOM — иначе лексер падает.
- **`print` — единственный канал вывода.** Он получает строку; возвращать
  строку из `main` эффективнее, если строк много.

## Что попробовать

1. Сделайте `count_byte` для кириллической буквы: посчитайте байт `208`
   (первый байт многих букв) и объясните, почему это не число букв.
2. Напишите `starts_with(s, prefix)` через побайтовое сравнение.
3. Соберите строку из 1000 фрагментов и сравните время с одним `repeat`.
4. Передайте в `main` строку с эмодзи (4 байта UTF-8) и проверьте `length`.

## Связанные разделы

- [Latent во фронтенде](../guide/web-and-frontend.md) — строки и массивы в ABI.
- [Массивы и строки](../guide/arrays-and-strings.md) — язык.
- [WASM ABI](../reference/wasm-abi.md#строка) — точная раскладка.
- [Данные и массивы](./frontend-data-processing.md) · [Калькулятор](./frontend-calculator.md).
