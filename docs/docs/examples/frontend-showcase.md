---
title: "Девять интерактивных страниц Latent"
sidebar_label: "Демо и приложение"
sidebar_position: 15
description: "Девять страниц в браузере: горутины и каналы, AI-примитивы, self-hosted компилятор, песочница, модули, Palette Studio — плюс бенчмарк, canvas-фильтры и физика. Настоящее исполнение, живые метрики, известные ограничения."
---

# Девять интерактивных страниц Latent

Девять страниц ниже запускают Latent прямо в браузере. Пять из них — про язык:
горутины и каналы, AI-примитивы, self-hosted компилятор, песочницу и модули.
Одна — рабочее приложение для дизайн-системы. Ещё три — про плотные вычисления:
бенчмарк, фильтры изображений и физику.

Здесь нет записанных видео и «средних чисел с нашей машины»: код исполняется у
вас, метрики считаются на месте, исходники `.lat` лежат рядом. Всё это —
статические страницы без сборщика и внешних зависимостей, в
`docs/static/demos/`, публикация на `/latent/demos/...`. Копия интерпретатора для
офлайна — в `demos/vendor/compiler/`.

## Карта: страница, сильная сторона, что видно

| Страница | Сильная сторона | Что видно |
|---|---|---|
| <a href="/latent/demos/concurrency/">Горутины и каналы</a> | CSP в грамматике: `spawn`, `channel`, `<-`, `select`, `yield` | живую визуализацию горутин, труб-каналов и токенов; трассу планировщика; fan-in, map-reduce, worker pool, select, **1000 горутин**, дедлок |
| <a href="/latent/demos/ai/">AI-native</a> | `ai_embed`, `ai_infer`, `ai_stream`, `tensor`, `matmul` — синтаксис языка | эмбеддинги как векторы, heatmap косинусной близости, стриминг токенов, реальные A/B/C матрицы, опциональный gateway |
| <a href="/latent/demos/selfhost/">Компилятор компилирует себя</a> | `seed.wasm` 41 KiB компилирует `shc.lat` 164 KiB в браузере | цепочку `seed → stage1′ → stage2′ → stage3′`, sha256 каждой стадии, **FIXED POINT**, запуск sample |
| <a href="/latent/demos/sandbox/">Песочница</a> | один импорт `env.print`, wasm-trap и терминирование Worker | редактор → `compiler.wasm` → Worker; бесконечный цикл, OOB, `memory.grow` 64 MiB, отказ DOM/fetch |
| <a href="/latent/demos/modules/">Модули</a> | `import`/`export`, граф модулей, двухфазная линковка | дерево из 4 `.lat`, SVG-граф, мангленные имена, цикл `a ↔ b`, сборка через `latent_compile_files` |
| <a href="/latent/demos/palette/">Palette Studio</a> | приложение: пиксели → палитра → CSS-токены | загрузку изображения, редактируемые свотчи, WCAG-контраст, экспорт CSS/JSON/PNG и **честный benchmark** с JS-двойником |
| <a href="/latent/demos/bench/">Бенчмарк</a> | плотные `i32`-циклы в линейной памяти | JS vs Latent→WASM на пяти алгоритмах, медианы, parity-суммы |
| <a href="/latent/demos/image/">Изображения</a> | указатели в памяти вместо копирования | grayscale, blur, Sobel, threshold над `ImageData`, слайдер «оригинал/фильтр» |
| <a href="/latent/demos/physics/">Физика</a> | один буфер, фиксированная точка, нет GC | до 30 000 частиц, FPS-график, сравнение с JS-двойником бит в бит |

## 1. Горутины и каналы

Главное демо. Восемь сценариев — настоящие Latent-программы с `spawn`,
`channel`, `ch.send`, `select` и `yield`. Движок №1 исполняет программу, записывает
трассу (спавны, сообщения, ожидания, шаги планировщика), а страница воспроизводит
её как анимацию. Метрики берутся из прогона, а не из анимации.

<iframe
  src="/latent/demos/concurrency/?embed=1"
  title="Latent — горутины, каналы и планировщик"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

Если iframe не загрузился, откройте страницу напрямую:
<a href="/latent/demos/concurrency/">latent/demos/concurrency</a>.

```latent
// Не компилируется движком №2: каналы и spawn требуют host-рантайма.
// Исполняется движком №1 в демо.
fn producer(ch: channel, n: int) {
    let i = 1;
    while (i <= n) {
        ch.send(i * i);
        i = i + 1;
    }
}

fn consumer(ch: channel, n: int) {
    let sum = 0;
    let got = 0;
    while (got < n) {
        let v = ch.recv();
        sum = sum + v;
        got = got + 1;
    }
    print("consumer: got", got, "sum =", sum);
}

fn main() -> int {
    let ch = channel();
    spawn producer(ch, 12);
    spawn consumer(ch, 12);
    return 0;
}
```

Что видно в демо: producer/consumer на канале, fan-in трёх воркеров, четыре
воркера с частичными суммами (map-reduce), worker pool на двух каналах,
select-гонку, 1000 горутин, дедлок и семантику `yield`. Для каждого сценария
рядом лежит JS-эквивалент на промисах — можно сравнить объём и читаемость.

Планировщик здесь кооперативный: один поток, каналы без ограничения очереди,
`select` опрашивает ветки по порядку. Это видно в счётчиках и в разделе
ограничений на самой странице.

## 2. AI-native примитивы

<iframe
  src="/latent/demos/ai/?embed=1"
  title="Latent — AI-примитивы в браузере"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

```latent
// host-only: ai_embed/cosine_similarity требуют host-рантайма (движок №1).
fn main() -> int {
    let docs = ["channels and goroutines", "ai-native primitives"];
    let mat = [];
    let i = 0;
    while (i < docs.length) {
        mat.push(ai_embed(docs[i]));
        i = i + 1;
    }
    let q = ai_embed("how do channels work?");
    i = 0;
    while (i < docs.length) {
        print("sim", i, cosine_similarity(q, mat[i]));
        i = i + 1;
    }
    return 0;
}
```

Страница исполняет программу с `ai_embed`, `cosine_similarity`, `ai_infer`,
`ai_stream`/`stream_next`, `tensor` и `matmul`, а затем визуализирует **реальные**
значения: 8-мерные векторы, матрицу похожести, рейтинг документов, поток токенов
и матрицы A(2×3)·B(3×2)=C(2×2). По умолчанию — детерминированный офлайн-mock из
`interpreter-ai.js`; при желании можно подключить Ollama/OpenAI-совместимый
gateway (только для `ai_infer`, ключ не сохраняется).

Mock-эмбеддинги — это хэш-проекция, а не семантика. Стриминг печатает токены,
которые интерпретатор уже получил, а `ai_generate!` разбирает Rust-парсер
(движок №2), но JS-интерпретатор его не исполняет. На странице это написано
рядом с результатом, чтобы не возникало иллюзий.

## 3. Компилятор компилирует себя

<iframe
  src="/latent/demos/selfhost/?embed=1"
  title="Latent — self-hosted компилятор в браузере"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

```latent
// Этот sample компилируется seed.wasm и исполняется в демо.
fn main() -> int {
    print("hello from seed.wasm");
    return 42;
}
```

Демо загружает `seed.wasm` (41.5 KiB), сверяет его sha256 с `seed.json` и в Web
Worker компилирует `selfhost/shc.lat` (164 KiB) три раза: `seed → stage1′ →
stage2′ → stage3′`. Каждая стадия показывает размер, время и sha256; равенство
байтов проверяется через `crypto.subtle` + побайтовое сравнение. В текущей
сборке `seed = stage1′ = stage2′ = stage3′` — неподвижная точка с первого шага.
Затем тот же seed компилирует и запускает выбранный sample через ABI
`[len][utf8]` → `main()` → `[len][wasm]`.

Seed — доверенная точка: часть host-only корпуса selfhost-компилятор может
отвергнуть, а таймаут 30 секунд терминирует Worker. Это ограничение
воспроизводимости, а не магия.

## 4. Песочница для недоверенного кода

<iframe
  src="/latent/demos/sandbox/?embed=1"
  title="Latent — безопасное исполнение недоверенного кода"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

Пользователь пишет Latent-код, `compiler.wasm` компилирует его в WASM, а Worker
инстанцирует модуль с **единственным** импортом `env.print`. Страница показывает
реальный список импортов из `WebAssembly.Module.imports()` — не декларацию, а
бинарник.

Что можно нажать: бесконечный цикл (host вызывает `worker.terminate()` по
таймауту), OOB-доступ (`memory access out of bounds`), `alloc(64 MiB)` (память
растёт до 1025 страниц), доступ к `alert`/`fetch` (ошибка компиляции: таких
имён в языке нет). Capability-список, gauge памяти и журнал событий обновляются
по ходу.

Это не OS-песочница и не граница против багов браузера: `compiler.wasm`
считается доверенным, а таймаут живёт на хосте. Что именно изолировано, а что
нет — разобрано в разделе ограничений на странице и в
[реестре](../specs/limitations.md).

## 5. Многофайловый проект

<iframe
  src="/latent/demos/modules/?embed=1"
  title="Latent — модули и линковка в браузере"
  loading="lazy"
  style={{width: '100%', height: '980px', border: 0, borderRadius: '12px'}}
/>

```latent
// Не компилируется отдельно: модульный файл (entry-файл проекта).
import { mean, square } from "./math.lat";
import { variance } from "./stats.lat";

fn main() -> int {
    let data = [2, 4, 6, 8];
    print("mean =", mean(data));
    print("variance =", variance(data));
    return square(9);
}
```

Дерево из четырёх файлов, редактор, SVG-граф импортов, двухфазная линковка и
запуск. Демо использует настоящий `resolveModuleGraph` / `linkModuleProject` из
`web-ide/compiler` и показывает мангленные имена (`m1$square`, `m3$variance`) —
результат линковки, а не подпись. Проект «cycles allowed» демонстрирует
разрешённый цикл `a.lat ↔ b.lat`, «missing import» — ошибку с путём и строкой.

Сборка: страница проверяет `compiler.wasm` через `WebAssembly.Module.exports`.
Если есть `latent_compile_files`, кодируется manifest `LPF1` и проект
компилируется в WASM (как в текущей сборке); иначе — исполняется движком №1.
Обе ветки настоящие.

Модули v1 — только именованные импорты и относительные `.lat`-пути; редактор
живёт в памяти вкладки; циклы разрешены линковкой, но рекурсия остаётся
рекурсией.

## 6. Palette Studio: приложение, а не витрина

<iframe
  src="/latent/demos/palette/?embed=1"
  title="Palette Studio — палитра и CSS-токены из изображения"
  loading="lazy"
  style={{width: '100%', height: '820px', border: 0, borderRadius: '12px'}}
/>

Это рабочий инструмент для дизайн-системы: загрузите логотип или скриншот,
получите палитру, поправьте свотчи, проверьте WCAG-контраст и скопируйте
CSS-переменные, JSON или PNG. Изображение не уходит на сервер — пиксели читает
`palette.wasm`.

```latent
fn bin_of(r: int, g: int, b: int) -> int {
    // 3 бита на канал: 512 бинов, достаточно для 5–8 цветов бренда.
    return (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
}
```

Внутри приложения есть JS-двойник того же алгоритма на `Uint32Array`. Кнопка
«Сравнить с JS-версией» запускает оба варианта на одних и тех же пикселях и
показывает медиану: на изображении 480×293 Latent стабильно быстрее, а палитры
совпадают. Это не «синтетический бенчмарк»: тот же файл, те же данные, тот же
результат.

Ограничения приложения: sRGB, квантование 3 бита на канал, alpha &lt; 128
пропускается, изображение уменьшается до 480 px, контраст считается на хосте.
Для точной колориметрии и OKLCH нужен другой инструмент.

## Производительность: бенчмарк, изображения, физика

Три демо про плотные вычисления и предсказуемую память. Они не про CSP или AI —
они про то, что `int` — это ровно `i32`, `alloc` — явное выделение, а горячий
цикл не зависит от JIT-настроения.

<iframe
  src="/latent/demos/bench/?embed=1"
  title="Latent vs JavaScript — интерактивный бенчмарк"
  loading="lazy"
  style={{width: '100%', height: '780px', border: 0, borderRadius: '12px'}}
/>

```latent
// FNV-1a over a 1 MiB byte buffer, `rounds` passes.
fn main(n: int, rounds: int) -> int {
    let ptr = load32(8);
    if (ptr == 0) {
        ptr = alloc(n + 8);
        store32(8, ptr);
    }
    let h = 0 - 2128831035;
    let r = 0;
    while (r < rounds) {
        let i = 0;
        while (i < n) {
            h = (h ^ load8(ptr + i)) * 16777619;
            i = i + 1;
        }
        r = r + 1;
    }
    return h;
}
```

- <a href="/latent/demos/bench/">Бенчмарк</a>: пять алгоритмов, одинаковые входы,
  проверка контрольных сумм и медиана трёх прогонов.
- <a href="/latent/demos/image/">Изображения</a>: grayscale, box blur, Sobel,
  threshold над `ImageData`; переключатель WASM/JS и слайдер сравнения.
- <a href="/latent/demos/physics/">Физика</a>: до 30 000 частиц, три аттрактора,
  FPS-график и parity с JS-двойником бит в бит.

На коротких вызовах накладные расходы JS↔WASM могут съесть выигрыш; демо
показывает и это. Цифры живые и зависят от машины.

## Как это устроено

```
docs/static/demos/
├── index.html                 # хаб демо
├── assets/
│   ├── demo.css               # общий shell старых демо
│   ├── killer.css             # дизайн-система пяти новых демо
│   ├── killer.js              # highlighter, CodeViewer, EnhancedEditor, canvas
│   ├── wasm.js                # fetch/instantiate, C-ABI компилятора
│   └── bench.js / imaging.js / physics.js
├── vendor/compiler/           # копия движка №1 (ESM) — генерируется build-demos
├── concurrency/               # index.html + killer-programs.js + killer-concurrency.js
├── ai/                        # index.html + killer-ai.js
├── selfhost/                  # index.html + killer-selfhost.js + seed.wasm + shc.lat
├── sandbox/                   # index.html + killer-sandbox.js
├── modules/                   # index.html + killer-modules.js
├── bench/  image/  physics/   # старые демо (WASM-модули компилируются build-demos)
├── compiler.wasm              # компилятор для sandbox/modules
└── build-demos.mjs            # vendor-копия + seed/shc + .lat → .wasm + smoke-run
```

1. **Подготовка артефактов.** `build-demos.mjs` копирует `web-ide/compiler/**` в
   `demos/vendor/compiler/` (ESM-интерпретатор), `selfhost/seed.wasm`,
   `seed.json` и `shc.lat` — в `demos/selfhost/`, затем компилирует `.lat`-файлы
   старых демо через `compiler.wasm` и делает smoke-run.
2. **Исполнение.** Новые демо импортируют интерпретатор из vendor и исполняют
   Latent-код в браузере; sandbox/modules берут `compiler.wasm` (движок №2) и
   ABI `latent_compile` / `latent_compile_files`.
3. **Изоляция.** Sandbox запускает wasm в Web Worker с одним импортом и
   терминирует по таймауту; selfhost тоже компилирует в Worker (30 с лимит).
4. **Метрики.** Время, размеры, sha256, импорты, память и события берутся из
   реальных вызовов; анимация — только представление уже полученных данных.
5. **Офлайн.** Никаких CDN, шрифтов и сборщика: только относительные пути,
   `fetch` локальных ассетов и браузерные API.

Полный ABI — в [WASM ABI](../reference/wasm-abi.md), модули — в
[гайде по модулям](../guide/modules.md), selfhost — в
[спецификации](../specs/selfhost.md).

## Где Latent не выигрывает

- **Параллелизм.** Движок №1 — кооперативный планировщик в одном потоке; это не
  многопоточность и не ускорение на ядрах.
- **AI по умолчанию.** Эмбеддинги — mock, инференс — mock; реальный gateway
  опционален и ограничен CORS/провайдером.
- **Песочница.** Это изоляция возможностей wasm, а не OS-level sandbox;
  компилятор и браузер считаются доверенными.
- **Self-host.** Seed — доверенная точка, часть host-only корпуса не
  компилируется; таймаут — защита, а не «бесконечная мощность».
- **Производительность.** На коротких вызовах JS может быть быстрее; выигрыш —
  в предсказуемой памяти и отсутствии GC-пауз, а не в «WASM всегда быстрее».

## Запуск и проверка

Демо не требуют сборки. Достаточно отдать `docs/static/` статическим сервером:

```bash
# из корня репозитория
python -m http.server 8000 --directory docs/static
# откройте http://localhost:8000/demos/
```

Пересобрать артефакты после правок:

```bash
node docs/static/demos/build-demos.mjs            # vendor + seed/shc + .wasm + smoke
node docs/static/demos/build-demos.mjs --no-verify
node docs/scripts/validate-examples.mjs           # все ```latent-блоки
cd docs && pnpm run build                         # сайт и битые ссылки
```

`build-demos.mjs` использует `web-ide/compiler.wasm` (переопределяется
`LATENT_COMPILER_WASM`). Пять новых демо не зависят от `demo.css` — у них своя
`assets/killer.css`, поэтому редизайн хаба их не ломает.

## Что попробовать

1. В **горутинах** нажмите «1000 горутин» и посмотрите на пик живых горутин и на
   то, что выполняется ровно одна; затем «Дедлок» — рантайм остановит программу.
2. В **AI** поменяйте prompt и документы, нажмите «Пересчитать» и наведите на
   клетку heatmap: значения придут из `cosine_similarity` интерпретатора.
3. В **selfhost** дождитесь FIXED POINT и сравните sha256 всех стадий; затем
   выберите `fib.lat` и посмотрите на `main() = 55`.
4. В **песочнице** нажмите «Бесконечный цикл», затем «OOB-доступ» и
   `memory.grow` — журнал покажет terminate, trap и 1025 страниц.
5. В **модулях** переключитесь на «cycles allowed», запустите и посмотрите на
   цикл `a.lat ↔ b.lat` в графе; затем «missing import» — ошибка с путём.
6. В **Palette Studio** загрузите свой скриншот, поправьте один свотч, скопируйте
   CSS и нажмите «Сравнить с JS-версией» — увидите реальную медиану на вашем
   изображении, а не число из презентации.

## Связанные разделы

- [WASM ABI](../reference/wasm-abi.md) — `main`, `memory`, строки, массивы,
  C-ABI компилятора.
- [Модули](../guide/modules.md) — синтаксис, семантика и линковка v1.
- [Self-host](../specs/selfhost.md) — фиксированная точка и bootstrap.
- [Конкурентность](../guide/concurrency.md) — `spawn`, `channel`, `select`.
- [AI-примитивы](../guide/ai-features.md) — `ai_infer`, `ai_embed`, тензоры.
- [Web IDE](../tooling/web-ide.md) — playground с двумя движками.
