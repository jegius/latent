---
title: "Обработка массива в WASM"
sidebar_label: "Данные и массивы"
sidebar_position: 11
description: "Передача массива i32 в Latent-модуль через линейную память, сортировка и агрегация на месте, чтение результата из memory; вариант без параметров main."
---

# Обработка массива в WASM

Кейс: JS передаёт в Latent-модуль массив чисел, модуль сортирует его и считает
статистику, JS читает результат из линейной памяти. Это базовый сценарий для
фильтрации, агрегации, валидации и любой «тяжёлой» обработки данных на клиенте.

## Формат данных

Массив в памяти Latent — это `[len u32 LE][элемент0 i32][элемент1 i32]...`:

```text
адрес → +0  длина N (u32 LE)
        +4  data[0]
        +8  data[1]
        ...
        +4+4·(N-1)  data[N-1]
```

Указатель — на длину. Элемент всегда 4 байта, поэтому `float`-массивы в движке
№2 не поддерживаются. Границы не проверяются: `data[N]` — чтение за пределами
блока.

Чтобы не трогать статическую область (строковые литералы начинаются с адреса
1024), входной массив кладут в «почтовый ящик» ниже 1024 — например, по адресу
`16`. Это соглашение хоста и программы, а не часть ABI; подробнее —
[гайд, §3.4](../guide/web-and-frontend.md#34-куда-писать-входные-данные).

## Ядро: сортировка и статистика

```latent
fn sort(arr: [int]) -> [int] {
    let n = arr.length;
    for (let i = 0; i < n; i = i + 1) {
        for (let j = 0; j < n - i - 1; j = j + 1) {
            if (arr[j] > arr[j + 1]) {
                let t = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = t;
            }
        }
    }
    return arr;
}

fn total(arr: [int]) -> int {
    let s = 0;
    for (let i = 0; i < arr.length; i = i + 1) {
        s = s + arr[i];
    }
    return s;
}

fn main(data: [int]) -> [int] {
    let ordered = sort(data);
    let sum = total(ordered);
    print("count:", ordered.length);
    print("sum:", sum);
    print("average:", sum / ordered.length);
    print("min:", ordered[0]);
    print("max:", ordered[ordered.length - 1]);
    return ordered;
}
```

Разбор:

- `data: [int]` — это `i32`-указатель. JS передаёт его аргументом `main`;
  сигнатура экспорта — `(i32) -> i32`.
- Сортировка идёт **на месте**: `arr[j] = ...` пишет в ту же память, которую
  прочитал JS. Возвращается тот же указатель.
- `sum / ordered.length` — целочисленное деление: среднее `245 / 8` = `30`.
- `print` после сортировки безопасен: входной массив лежит по адресу `16`, а
  строки для вывода аллоцируются в куче (≥ 1024) и не перекрывают его.
- Если бы массив строился через `push` в куче, `print` мог бы затереть
  элементы: `push` не резервирует ёмкость. См.
  [Bump-аллокатор и `push`](../guide/arrays-and-strings.md#массивы).

## JS-хост: запись входа и чтение результата

```js
const INPUT = 16; // «почтовый ящик» ниже статической области

function ensureCapacity(memory, endByte) {
  const needPages = Math.ceil(endByte / 65536);
  const havePages = memory.buffer.byteLength / 65536;
  if (needPages > havePages) memory.grow(needPages - havePages);
}

function writeI32Array(memory, addr, values) {
  ensureCapacity(memory, addr + 4 + values.length * 4);
  const view = new DataView(memory.buffer);
  view.setUint32(addr, values.length, true);
  for (let i = 0; i < values.length; i += 1) {
    view.setInt32(addr + 4 + i * 4, values[i], true);
  }
  return addr;
}

function readI32Array(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return Array.from({length: len}, (_, i) => view.getInt32(ptr + 4 + i * 4, true));
}

function readString(memory, ptr) {
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 4, len));
}

let instance;
const imports = {
  env: {
    print(ptr) {
      document.querySelector('#log').textContent +=
        readString(instance.exports.memory, ptr) + '\n';
    },
  },
};

const bytes = await (await fetch('./data.wasm')).arrayBuffer();
({instance} = await WebAssembly.instantiate(bytes, imports));

const memory = instance.exports.memory;
writeI32Array(memory, INPUT, [42, 7, 19, 3, 88, 21, 10, 55]);

const resultPtr = instance.exports.main(INPUT);
const sorted = readI32Array(memory, resultPtr);
console.log(sorted); // [3, 7, 10, 19, 21, 42, 55, 88]
```

**Что вы увидите** в `#log`:

```
count:
8
sum:
245
average:
30
min:
3
max:
88
```

и в консоли — `[3, 7, 10, 19, 21, 42, 55, 88]`. Каждый аргумент `print` —
отдельная строка: `"count:"` и `8` печатаются раздельно.

Обратите внимание: `readI32Array` читает `memory.buffer` **после** `main`.
Если бы JS писал в буфер до вызова, он мог бы прочитать его до роста памяти,
но `DataView` создаётся заново при каждом чтении — это защищает от
отсоединения буфера после `memory.grow`.

## Вариант без параметров `main` (строгий ABI)

Если модуль должен работать с чужим хостом, который вызывает `main()` без
аргументов, вход читают из фиксированного адреса встроенными `load32`/`store32`:

```latent
fn sort_raw(ptr: int, n: int) {
    let i = 0;
    while (i < n) {
        let j = 0;
        while (j < n - i - 1) {
            let a = load32(ptr + 4 + j * 4);
            let b = load32(ptr + 4 + (j + 1) * 4);
            if (a > b) {
                store32(ptr + 4 + j * 4, b);
                store32(ptr + 4 + (j + 1) * 4, a);
            }
            j = j + 1;
        }
        i = i + 1;
    }
}

fn main() -> int {
    let n = load32(16);
    let out = alloc(4 + n * 4);
    store32(out, n);
    let i = 0;
    while (i < n) {
        store32(out + 4 + i * 4, load32(20 + i * 4));
        i = i + 1;
    }
    sort_raw(out, n);
    print("count:", n);
    print("min:", load32(out + 4));
    print("max:", load32(out + 4 + (n - 1) * 4));
    return out;
}
```

JS в этом варианте пишет длину по адресу `16`, элементы — с `20`, вызывает
`main()` без аргументов и читает массив по возвращённому указателю:

```js
const values = [42, 7, 19, 3, 88, 21, 10, 55];
const view = new DataView(memory.buffer);
view.setUint32(16, values.length, true);
values.forEach((value, i) => view.setInt32(20 + i * 4, value, true));

const ptr = instance.exports.main();
console.log(readI32Array(memory, ptr));
```

Здесь `alloc` — встроенная функция Latent (не экспорт модуля): она выделяет
блок в куче и возвращает указатель. Размер `4 + n*4` — заголовок плюс
элементы.

## Ограничения и подводные камни

- **Только 4-байтовые элементы.** `[float]`, `[bool]` и массивы указателей
  представимы, но `float` в памяти будет мусором: элементы пишутся как `i32`.
- **Нет проверки границ.** Ошибка в индексе — порча памяти или trap, а не
  исключение.
- **Нет `free`.** Каждый `alloc`/литерал/`push` увеличивает кучу; повторные
  вызовы `main` в долгой странице лучше не делать аллоцирующими.
- **`push` не резервирует ёмкость** — не смешивайте `push` в `[]` с
  последующими аллокациями до чтения массива.
- **Среднее — целочисленное.** Для дробей либо масштабируйте значения, либо
  считайте в JS.
- **Сортировка O(n²).** Для больших массивов реализуйте quicksort/mergesort или
  обрабатывайте данные порциями в Web Worker.

## Что попробовать

1. Замените bubble sort на сортировку выбором и сравните число операций.
2. Верните из `main` два массива (два указателя упаковать в массив-результат).
3. Добавьте фильтр `value >= threshold` и проверьте граничные значения.
4. Передайте 100 000 чисел и посмотрите, как сработает `memory.grow`
   (и не забудьте про `ensureCapacity`).

## Связанные разделы

- [Latent во фронтенде](../guide/web-and-frontend.md) — ABI и память.
- [Массивы и строки](../guide/arrays-and-strings.md) — `push`, `pop`, индексация.
- [Память и низкий уровень](../guide/memory-and-low-level.md) — аллокатор.
- [Строки](./frontend-strings.md) · [Canvas](./frontend-canvas.md).
