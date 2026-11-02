// test/modules-engine1.test.js — нативные файловые модули движка №1.
//
// Проверяем линковку (fn/class/enum), алиасы, циклы/взаимную рекурсию,
// enum-конструкторы (в т.ч. несколько полей), host-фичи в модулях и
// понятные ошибки линковщика/парсера.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    runLatent, runLatentProject, linkModuleProject,
    clearLinkedModuleCache, ModuleError,
} from '../compiler-loader.js';

const MATH = `export fn square(x: int) -> int { return x * x; }

export class Point {
    x: int;
    y: int;
    fn init(x: int, y: int) { this.x = x; this.y = y; }
    fn norm2() -> int { return square(this.x) + square(this.y); }
}

export enum Shape { Circle(int), Rect(int, int), Empty }
`;

const UTIL = `import { square as sq } from "./math.lat";
export fn sumSquares(a: int, b: int) -> int { return sq(a) + sq(b); }
`;

const MAIN = `import { Point, Shape } from "./math.lat";
import { sumSquares } from "./util.lat";

fn main() -> int {
    let p = new Point(3, 4);
    let s = Circle(2);
    print("norm2=" + p.norm2());
    return match s {
        case Circle(r): { return p.norm2() + sumSquares(r, 1); }
        default: 0
    };
}
`;

const PROJECT = [
    { name: 'main.lat', code: MAIN },
    { name: 'math.lat', code: MATH },
    { name: 'util.lat', code: UTIL },
];

test('engine1: 3-файловый проект — fn/class/enum через import', async () => {
    const out = await runLatentProject(PROJECT, 'main.lat', false);
    assert.equal(out.result, 30);
    assert.deepEqual(out.output, ['norm2=25']);
    assert.equal(out.modules, 3);
    assert.deepEqual(out.modulePaths, ['main.lat', 'math.lat', 'util.lat']);
});

test('engine1: enum с несколькими полями связывается по позициям', async () => {
    const out = await runLatentProject([
        { name: 'shape.lat', code: 'export enum Rect { R(int, int), Empty }\n' },
        {
            name: 'main.lat',
            code: `import { Rect } from "./shape.lat";
fn area(r: int, h: int) -> int { return r * h; }
fn main() -> int {
    let s = R(3, 4);
    return match s { case R(w, h): { return area(w, h); } default: 0 };
}
`,
        },
    ], 'main.lat', false);
    assert.equal(out.result, 12);
});

test('engine1: 0-арный вариант enum используется как значение', async () => {
    const out = await runLatentProject([
        { name: 'e.lat', code: 'export enum Mode { On, Off }\n' },
        { name: 'main.lat', code: 'import { Mode } from "./e.lat";\nfn main() -> int { let m = On; return 1; }' },
    ], 'main.lat', false);
    assert.equal(out.result, 1);
});

test('engine1: взаимная рекурсия между двумя модулями (цикл импорта)', async () => {
    const files = [
        { name: 'a.lat', code: 'import { isOdd } from "./b.lat";\nexport fn isEven(n: int) -> bool { if (n == 0) { return true; } return isOdd(n - 1); }\n' },
        { name: 'b.lat', code: 'import { isEven } from "./a.lat";\nexport fn isOdd(n: int) -> bool { if (n == 0) { return false; } return isEven(n - 1); }\n' },
        { name: 'main.lat', code: 'import { isEven } from "./a.lat";\nfn main() -> int { if (isEven(10)) { return 1; } return 0; }' },
    ];
    const out = await runLatentProject(files, 'main.lat', false);
    assert.equal(out.result, 1);
    assert.equal(out.cycles.length, 1);
    assert.ok(out.cycles[0].includes('a.lat') && out.cycles[0].includes('b.lat'));
});

test('engine1: host-фичи (channel/print) работают в импортированном модуле', async () => {
    const out = await runLatentProject([
        {
            name: 'work.lat',
            code: `export fn produce() -> int {
    let ch = channel();
    ch <- 41;
    let v = ch.recv();
    print("work=" + v);
    return v + 1;
}
`,
        },
        { name: 'main.lat', code: 'import { produce } from "./work.lat";\nfn main() -> int { return produce(); }' },
    ], 'main.lat', false);
    assert.equal(out.result, 42);
    assert.deepEqual(out.output, ['work=41']);
});

test('engine1: side-effect import подключает модуль, не создавая имён', async () => {
    const out = await runLatentProject([
        { name: 'a.lat', code: 'export fn helper() { return 1; }' },
        { name: 'main.lat', code: 'import "./a.lat";\nfn main() -> int { return 2; }' },
    ], 'main.lat', false);
    assert.equal(out.result, 2);
    assert.equal(out.modules, 2);
});

test('engine1: импорт неэкспортированного символа — понятная ошибка', async () => {
    await assert.rejects(() => runLatentProject([
        { name: 'math.lat', code: 'export fn square(x: int) -> int { return x * x; }' },
        { name: 'main.lat', code: 'import { cube } from "./math.lat";\nfn main() { return cube(2); }' },
    ], 'main.lat', false), (e) => {
        assert.ok(e instanceof ModuleError);
        assert.equal(e.code, 'NOT_EXPORTED');
        assert.equal(e.path, 'main.lat');
        assert.equal(e.line, 1);
        assert.match(e.message, /does not export 'cube'/);
        return true;
    });
});

test('engine1: дубликат импортированного имени', async () => {
    await assert.rejects(() => runLatentProject([
        { name: 'math.lat', code: 'export fn square(x: int) -> int { return x * x; }' },
        { name: 'main.lat', code: 'import { square } from "./math.lat";\n' +
            'import { square as square } from "./math.lat";\nfn main() {}' },
    ], 'main.lat', false), (e) => e.code === 'DUPLICATE_IMPORT' &&
        /duplicate imported name 'square'/.test(e.message));
});

test('engine1: отсутствующий файл и импорт не на top-level', async () => {
    await assert.rejects(() => runLatentProject([
        { name: 'main.lat', code: 'import { x } from "./nope.lat";\nfn main() {}' },
    ], 'main.lat', false), (e) => e.code === 'MODULE_NOT_FOUND' &&
        /main\.lat:1:/.test(e.message));

    await assert.rejects(() => runLatentProject([
        { name: 'main.lat', code: 'fn main() { import "./x.lat"; }' },
    ], 'main.lat', false), (e) => e.code === 'MODULE_PARSE_ERROR' &&
        /only allowed at top level/.test(e.message));

    await assert.rejects(() => runLatentProject([
        { name: 'main.lat', code: 'fn main() { export fn f() {} }' },
    ], 'main.lat', false), (e) => e.code === 'MODULE_PARSE_ERROR' &&
        /only allowed at top level/.test(e.message));
});

test('engine1: export только fn/class/enum, путь только относительный', async () => {
    await assert.rejects(() => runLatentProject([
        { name: 'main.lat', code: 'export let x = 1;\nfn main() {}' },
    ], 'main.lat', false), /export supports only fn, class, enum/);

    await assert.rejects(() => runLatentProject([
        { name: 'math.lat', code: 'export fn square() { return 1; }' },
        { name: 'main.lat', code: 'import { square } from "math.lat";\nfn main() {}' },
    ], 'main.lat', false), (e) => e.code === 'MODULE_PATH_NOT_RELATIVE' &&
        /relative/.test(e.message));

    await assert.rejects(() => runLatentProject([
        { name: 'main.lat', code: 'import { x } from "./math";\nfn main() {}' },
    ], 'main.lat', false), (e) => e.code === 'MODULE_PATH_EXTENSION');
});

test('engine1: нет main в entry — прежняя ошибка интерпретатора', async () => {
    await assert.rejects(() => runLatentProject([
        { name: 'lib.lat', code: 'export fn f() { return 1; }' },
        { name: 'main.lat', code: 'import { f } from "./lib.lat";' },
    ], 'main.lat', false), /Function 'main' not found/);
});

test('engine1: runLatent с import подсказывает project API', async () => {
    await assert.rejects(() => runLatent('import "./x.lat";\nfn main() {}', false),
        /runLatentProject/);
});

test('engine1: кэш линковки возвращает тот же результат для неизменного проекта', () => {
    clearLinkedModuleCache();
    const first = linkModuleProject(PROJECT, 'main.lat');
    const second = linkModuleProject([...PROJECT].reverse(), 'main.lat');
    assert.equal(first, second, 'порядок файлов не влияет на ключ кэша');
    const changed = PROJECT.map((f) => (f.name === 'math.lat'
        ? { ...f, code: f.code + '\n// changed\n' } : f));
    const third = linkModuleProject(changed, 'main.lat');
    assert.notEqual(first, third);
});

test('engine1: module cache не портится повторной линковкой (AST клонируется)', async () => {
    clearLinkedModuleCache();
    const one = linkModuleProject(PROJECT, 'main.lat', { noCache: true });
    const two = linkModuleProject(PROJECT, 'main.lat', { noCache: true });
    assert.notEqual(one.program, two.program);
    assert.equal(one.program.mainName, two.program.mainName);
    assert.ok(one.program.functions[one.program.mainName]);
});
