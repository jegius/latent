---
title: "Canvas: фрактал и сортировка"
sidebar_label: "Canvas и кадры"
sidebar_position: 13
description: "Latent считает кадр (треугольник Серпинского) или шаг сортировки, JS рисует через ImageData на canvas; кэширование буфера в памяти и повторные вызовы main."
---

# Canvas: фрактал и сортировка

WASM хорошо подходит для пиксельных и вычислительных кадров: модуль считает
массив байтов или чисел, JS рисует его на `<canvas>`. Здесь два кейса:

1. **Фрактал** — треугольник Серпинского, по одному кадру на вызов `main`,
   с бегущей вертикальной полосой.
2. **Визуализация сортировки** — модуль делает один проход bubble sort за
   кадр, JS рисует столбики.

Оба используют один и тот же приём: состояние (указатель на буфер) хранится в
линейной памяти, потому что глобальных переменных в языке нет.

## Кейс 1: треугольник Серпинского

Правило: пиксель `(x, y)` закрашен, если `(x & y) == 0` — классический
битовый фрактал. Плюс вертикальная полоса `x == frame % 256`, чтобы кадр
менялся. Никаких `float`, только `int` и битовые операторы.

```latent
// Кадр 256x256: 0 — фон, 1 — точка. Указатель на буфер кэшируется
// по адресу 20, потому что глобальных переменных в языке нет.
fn main(frame: int) -> int {
    let w = 256;
    let h = 256;
    let ptr = load32(20);
    if (ptr == 0) {
        ptr = alloc(4 + w * h);
        store32(ptr, w * h);
        store32(20, ptr);
    }
    let beam = frame % w;
    let y = 0;
    while (y < h) {
        let x = 0;
        while (x < w) {
            let v = 0;
            if ((x & y) == 0) {
                v = 1;
            }
            if (x == beam) {
                v = 1;
            }
            store8(ptr + 4 + y * w + x, v);
            x = x + 1;
        }
        y = y + 1;
    }
    return ptr;
}
```

- `alloc(4 + w*h)` выделяет заголовок и 65 536 байт пикселей **один раз**.
- `store32(20, ptr)` — это «глобальная переменная»: следующий вызов `main`
  прочитает указатель через `load32(20)` и не будет аллоцировать снова.
- `store8` пишет байт по адресу `ptr + 4 + y*w + x`.
- Возвращается указатель на `[len][байты]`; `len` = 65 536.

### HTML и отрисовка

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Latent: фрактал</title>
  <style>
    body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #111; }
    canvas { image-rendering: pixelated; width: 512px; height: 512px; }
  </style>
</head>
<body>
  <canvas id="frame" width="256" height="256"></canvas>

  <script type="module">
    const W = 256;
    const H = 256;
    const canvas = document.getElementById('frame');
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(W, H);

    let instance;
    const imports = {env: {print() {}}}; // print в этой программе не используется

    const bytes = await (await fetch('./fractal.wasm')).arrayBuffer();
    ({instance} = await WebAssembly.instantiate(bytes, imports));

    let frameIndex = 0;

    function draw() {
      // main синхронный: пока он считает кадр, вкладка занята.
      const ptr = instance.exports.main(frameIndex);

      const memory = instance.exports.memory; // buffer мог измениться после grow
      const view = new DataView(memory.buffer);
      const len = view.getUint32(ptr, true);
      const pixels = new Uint8Array(memory.buffer, ptr + 4, len);

      const data = image.data;
      for (let i = 0; i < W * H; i += 1) {
        const on = pixels[i] !== 0;
        data[i * 4] = on ? 40 : 245;
        data[i * 4 + 1] = on ? 220 : 245;
        data[i * 4 + 2] = on ? 180 : 245;
        data[i * 4 + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);

      frameIndex += 1;
      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  </script>
</body>
</html>
```

**Что вы увидите:** светлый треугольник Серпинского на тёмном фоне и
вертикальную полосу, которая за 256 кадров проходит слева направо. Кадр
считается в `main` целиком; на 256×256 это 65 536 итераций — для 60 fps
достаточно.

Важно: `pixels` — это **view** на память, а не копия. Если память вырастет,
старый `ArrayBuffer` отсоединится и view станет недействительным. В этом
примере буфер помещается в стартовый 1 МиБ и роста нет, но правило «брать
`memory.buffer` в каждом кадре» остаётся обязательным для больших кадров.

## Кейс 2: визуализация сортировки

Другой паттерн: `main` делает **один проход** сортировки и возвращает массив
высот `[len][i32...]`. JS рисует столбики и вызывает `main` со следующим
номером прохода.

```latent
fn generate(n: int, ptr: int) {
    store32(ptr, n);
    let i = 0;
    let seed = 12345;
    while (i < n) {
        seed = (seed * 75 + 74) % 65537;
        store32(ptr + 4 + i * 4, seed % 100);
        i = i + 1;
    }
}

fn step(ptr: int, pass: int) {
    let n = load32(ptr);
    let j = 0;
    while (j < n - pass - 1) {
        let a = load32(ptr + 4 + j * 4);
        let b = load32(ptr + 4 + (j + 1) * 4);
        if (a > b) {
            store32(ptr + 4 + j * 4, b);
            store32(ptr + 4 + (j + 1) * 4, a);
        }
        j = j + 1;
    }
}

fn main(pass: int) -> int {
    let n = 48;
    let ptr = load32(20);
    if (ptr == 0) {
        ptr = alloc(4 + n * 4);
        store32(20, ptr);
        generate(n, ptr);
    }
    if (pass < n) {
        step(ptr, pass);
    }
    return ptr;
}
```

- `generate` заполняет 48 столбиков детерминированным LCG (без `random`, без
  переполнения: `seed < 65537`, `seed * 75` помещается в `i32`).
- `main(pass)` — один проход; после 48 вызовов массив отсортирован.
- Сброс — записать `0` по адресу `20`; следующий вызов снова выделит и
  сгенерирует массив.

```html
<canvas id="bars" width="500" height="240"></canvas>
<button id="reset">Заново</button>
```

```js
const N = 48;
const BAR_W = 8;
const GAP = 2;
const canvas = document.getElementById('bars');
const ctx = canvas.getContext('2d');

let pass = 0;

function drawBars() {
  const ptr = instance.exports.main(pass);
  const memory = instance.exports.memory;
  const view = new DataView(memory.buffer);
  const len = view.getUint32(ptr, true);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < len; i += 1) {
    const value = view.getUint32(ptr + 4 + i * 4, true); // 0..99
    const height = Math.round((value / 99) * (canvas.height - 10));
    ctx.fillStyle = `hsl(${200 - value} 80% 60%)`;
    ctx.fillRect(i * (BAR_W + GAP), canvas.height - height, BAR_W, height);
  }

  pass += 1;
  if (pass < N) {
    requestAnimationFrame(drawBars);
  }
}

document.getElementById('reset').addEventListener('click', () => {
  // сброс состояния: следующий main(0) выделит буфер заново
  new DataView(instance.exports.memory.buffer).setUint32(20, 0, true);
  pass = 0;
  requestAnimationFrame(drawBars);
});

requestAnimationFrame(drawBars);
```

**Что вы увидите:** 48 разноцветных столбиков, которые за 48 кадров
выстраиваются по возрастанию. Кнопка «Заново» перемешивает их и запускает
сортировку с начала.

## Ограничения и подводные камни

- **`main` синхронный.** На больших кадрах (например, 1920×1080) вкладка будет
  подвисать; выносите расчёт в Web Worker или уменьшайте разрешение.
- **Память не освобождается.** Первый кадр аллоцирует буфер, дальше он
  переиспользуется. Если аллоцировать каждый кадр, куча вырастет на
  `W*H*fps` байт в секунду.
- **`memory.buffer` отсоединяется после `grow`.** Не кэшируйте `Uint8Array`
  навсегда; берите view от текущего `buffer` (или создавайте его в кадре).
- **Нет `requestAnimationFrame` в Latent.** Кадры и время — целиком на JS.
- **Нет `float`.** Фрактал на битовых операциях — не ограничение, а удобный
  способ остаться в целых числах; для плавных градиентов считайте в JS или
  используйте fixed-point.
- **`store8` не проверяет границы.** `x`/`y` за пределами `w`/`h` испортят
  соседнюю память.

## Что попробовать

1. Замените правило на `(x ^ y) < 128` и посмотрите на другой фрактал.
2. Сделайте кадр 64×64 и сравните FPS с 512×512.
3. Добавьте в сортировку подсветку сравниваемой пары (возвращайте ещё и
   индексы).
4. Перенесите расчёт кадра в Web Worker и передавайте `ImageData.data` в
   основной поток.

## Связанные разделы

- [Latent во фронтенде](../guide/web-and-frontend.md) — Worker и память.
- [Данные и массивы](./frontend-data-processing.md) — массивы `[len][i32]`.
- [Строки](./frontend-strings.md) — `[len][utf8]`.
- [WASM ABI](../reference/wasm-abi.md) — память и экспорты.
