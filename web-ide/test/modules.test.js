// test/modules.test.js — резолвер файловых модулей (движок №1).
//
// Проверяем канонизацию путей, DFS-граф от entry, циклы (разрешены),
// отсутствующие/дублирующиеся файлы, ошибки путей и кэш разбора.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ModuleError, ModuleCache, normalizeModulePath, resolveImportPath,
    resolveModuleGraph, sourceHasModuleSyntax, collectModuleImports,
    collectModuleExports,
} from '../compiler/modules.js';
import { tokenize } from '../compiler/lexer.js';
import { Parser } from '../compiler/parser.js';

function parse(source) {
    return new Parser(tokenize(source)).parseProgram();
}

test('normalizeModulePath: ./ .. \\ и вложенные каталоги', () => {
    assert.equal(normalizeModulePath('./math.lat'), 'math.lat');
    assert.equal(normalizeModulePath('lib/../math.lat'), 'math.lat');
    assert.equal(normalizeModulePath('.\\lib\\math.lat'), 'lib/math.lat');
    assert.equal(normalizeModulePath('lib/./sub/../math.lat'), 'lib/math.lat');
    assert.equal(normalizeModulePath(' math.lat '), 'math.lat');
});

test('normalizeModulePath: абсолютные пути, расширение и выход за корень', () => {
    const cases = [
        ['/abs/math.lat', 'MODULE_PATH_ABSOLUTE'],
        ['C:/abs/math.lat', 'MODULE_PATH_ABSOLUTE'],
        ['C:\\abs\\math.lat', 'MODULE_PATH_ABSOLUTE'],
        ['~/math.lat', 'MODULE_PATH_ABSOLUTE'],
        ['http://x/math.lat', 'MODULE_PATH_ABSOLUTE'],
        ['../math.lat', 'MODULE_PATH_OUTSIDE'],
        ['lib/../../math.lat', 'MODULE_PATH_OUTSIDE'],
        ['math', 'MODULE_PATH_EXTENSION'],
        ['math.txt', 'MODULE_PATH_EXTENSION'],
        ['', 'MODULE_PATH_EMPTY'],
    ];
    for (const [path, code] of cases) {
        assert.throws(() => normalizeModulePath(path), (e) => {
            assert.ok(e instanceof ModuleError, `${path}: не ModuleError`);
            assert.equal(e.code, code, `${path}: код ${e.code}`);
            return true;
        });
    }
});

test('resolveImportPath: относительно импортёра', () => {
    assert.equal(resolveImportPath('main.lat', './math.lat'), 'math.lat');
    assert.equal(resolveImportPath('main.lat', './lib/math.lat'), 'lib/math.lat');
    assert.equal(resolveImportPath('lib/main.lat', '../math.lat'), 'math.lat');
    assert.equal(resolveImportPath('lib/main.lat', './math.lat'), 'lib/math.lat');
    assert.throws(() => resolveImportPath('main.lat', 'math.lat'), /relative/);
    assert.throws(() => resolveImportPath('main.lat', 'math.lat'), (e) =>
        e.code === 'MODULE_PATH_NOT_RELATIVE');
});

test('resolveModuleGraph: DFS, канонические пути и детерминированный порядок', () => {
    const files = [
        { name: 'main.lat', code: 'import { x } from "./lib/math.lat";\nimport "./side.lat";\nfn main() { return x(); }' },
        { name: 'lib/math.lat', code: 'import { y } from "../util.lat";\nexport fn x() { return y(); }' },
        { name: 'util.lat', code: 'export fn y() { return 7; }' },
        { name: 'side.lat', code: '// подключён ради побочного эффекта' },
        { name: 'unreachable.lat', code: 'export fn z() { return 0; }' },
    ];
    const graph = resolveModuleGraph(files, 'main.lat');
    assert.equal(graph.entry, 'main.lat');
    assert.deepEqual(graph.modules.map((m) => m.path),
        ['lib/math.lat', 'main.lat', 'side.lat', 'util.lat']);
    assert.equal(graph.cycles.length, 0);
    assert.equal(graph.modules.length, 4, 'недостижимый файл не входит в граф');
    // Повторный импорт того же файла не дублирует модуль.
    const twice = resolveModuleGraph([
        { name: 'main.lat', code: 'import "./a.lat"; import "./a.lat"; fn main() {}' },
        { name: 'a.lat', code: '' },
    ], 'main.lat');
    assert.deepEqual(twice.modules.map((m) => m.path), ['a.lat', 'main.lat']);
});

test('resolveModuleGraph: пути разрешаются относительно импортёра, не entry', () => {
    const files = [
        { name: 'main.lat', code: 'import { a } from "./lib/a.lat"; fn main() { return a(); }' },
        { name: 'lib/a.lat', code: 'import { b } from "./b.lat"; export fn a() { return b(); }' },
        { name: 'lib/b.lat', code: 'export fn b() { return 1; }' },
    ];
    const graph = resolveModuleGraph(files, 'main.lat');
    assert.deepEqual(graph.modules.map((m) => m.path), ['lib/a.lat', 'lib/b.lat', 'main.lat']);
});

test('resolveModuleGraph: цикл разрешён и фиксируется', () => {
    const files = [
        { name: 'a.lat', code: 'import { b } from "./b.lat"; export fn a() { return 1; }' },
        { name: 'b.lat', code: 'import { a } from "./a.lat"; export fn b() { return 2; }' },
    ];
    const graph = resolveModuleGraph(files, 'a.lat');
    assert.deepEqual(graph.modules.map((m) => m.path), ['a.lat', 'b.lat']);
    assert.deepEqual(graph.cycles, [['a.lat', 'b.lat', 'a.lat']]);
});

test('resolveModuleGraph: отсутствующий файл — понятная ошибка с путём и строкой', () => {
    const files = [{ name: 'main.lat', code: '\nimport { x } from "./nope.lat";\nfn main() {}' }];
    assert.throws(() => resolveModuleGraph(files, 'main.lat'), (e) => {
        assert.ok(e instanceof ModuleError);
        assert.equal(e.code, 'MODULE_NOT_FOUND');
        assert.equal(e.path, 'main.lat');
        assert.equal(e.line, 2);
        assert.match(e.message, /main\.lat:2:/);
        assert.match(e.message, /nope\.lat/);
        assert.match(e.message, /workspace/);
        return true;
    });
});

test('resolveModuleGraph: дубликат файла и отсутствующий entry', () => {
    assert.throws(() => resolveModuleGraph([
        { name: 'a.lat', code: '' }, { name: './a.lat', code: '' },
    ], 'a.lat'), (e) => e.code === 'DUPLICATE_MODULE' && /duplicate/.test(e.message));

    assert.throws(() => resolveModuleGraph([{ name: 'a.lat', code: '' }], 'main.lat'),
        (e) => e.code === 'ENTRY_NOT_FOUND' && /entry file/.test(e.message));
});

test('resolveModuleGraph: неверные import-пути обёрнуты путём/строкой импортёра', () => {
    const cases = [
        ['import { x } from "math.lat";', 'MODULE_PATH_NOT_RELATIVE'],
        ['import { x } from "./math";', 'MODULE_PATH_EXTENSION'],
        ['import { x } from "C:/math.lat";', 'MODULE_PATH_NOT_RELATIVE'],
    ];
    for (const [line, code] of cases) {
        assert.throws(() => resolveModuleGraph([
            { name: 'main.lat', code: line + '\nfn main() {}' },
        ], 'main.lat'), (e) => {
            assert.equal(e.code, code, `${line}: ${e.message}`);
            assert.equal(e.path, 'main.lat');
            return true;
        });
    }
});

test('resolveModuleGraph: ошибка разбора модуля содержит путь файла', () => {
    assert.throws(() => resolveModuleGraph([
        { name: 'main.lat', code: 'import "./bad.lat"; fn main() {}' },
        { name: 'bad.lat', code: 'fn {' },
    ], 'main.lat'), (e) => {
        assert.equal(e.code, 'MODULE_PARSE_ERROR');
        assert.equal(e.path, 'bad.lat');
        assert.match(e.message, /^bad\.lat:/);
        return true;
    });
});

test('collectModuleImports/Exports: import/export узлы и side-effect', () => {
    const ast = parse('import { a, b as c } from "./x.lat";\nimport "./y.lat";\n' +
        'export fn f() {}\nexport class C {}\nexport enum E { A(int) }');
    const imports = collectModuleImports(ast);
    assert.equal(imports.length, 2);
    assert.deepEqual(imports[0].specifiers, [
        { imported: 'a', local: 'a' }, { imported: 'b', local: 'c' },
    ]);
    assert.deepEqual(imports[1].specifiers, []);
    const exports = collectModuleExports(ast);
    assert.deepEqual([...exports.keys()], ['f', 'C', 'E']);
    assert.deepEqual([...exports.values()].map((e) => e.kind), ['fn', 'class', 'enum']);
});

test('sourceHasModuleSyntax: import/export, но не строки и комментарии', () => {
    assert.equal(sourceHasModuleSyntax('import { a } from "./a.lat";'), true);
    assert.equal(sourceHasModuleSyntax('export fn f() {}'), true);
    assert.equal(sourceHasModuleSyntax('fn main() { print("import export"); }'), false);
    assert.equal(sourceHasModuleSyntax('// import "./x.lat"\nfn main() {}'), false);
    assert.equal(sourceHasModuleSyntax('let x = ;'), false, 'битый код — graceful false');
});

test('ModuleCache: переиспользует разбор и сбрасывается', () => {
    const cache = new ModuleCache(2);
    const a = cache.get('a.lat', 'export fn f() { return 1; }');
    const b = cache.get('a.lat', 'export fn f() { return 1; }');
    assert.equal(a, b, 'тот же файл не парсится повторно');
    assert.equal(a.ast.statements.length, 1);
    const c = cache.get('a.lat', 'export fn f() { return 2; }');
    assert.notEqual(a, c, 'изменённый файл — новая запись');
    cache.get('b.lat', '');
    cache.get('c.lat', '');
    cache.clear();
    assert.equal(cache.entries.size, 0);
});
