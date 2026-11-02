// tooling/latent-lsp/test/analyzer.test.mjs — documentSymbol/definition:
// объявления файла, вложенность классов и функций, локальные переменные.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    classOfVariable,
    enclosingClass,
    findSymbol,
    scanSymbols,
} from '../src/analyzer.mjs';
import { provideDefinition, provideDocumentSymbols } from '../src/symbols.mjs';

const DOC = `fn helper(x: int) -> int {
    return x * 2;
}

class Point {
    x: int;
    y: int;

    fn init(x, y) {
        this.x = x;
        this.y = y;
    }

    fn norm() {
        return this.x * this.x + this.y * this.y;
    }
}

enum Color {
    Red,
    Green,
}

test "arithmetic" {
    assert(1 + 1 == 2);
}

fn main() -> int {
    let p = new Point(3, 4);
    let stack = [1, 2, 3];
    let ch = channel<int>();
    return helper(p.x);
}
`;

test('scanSymbols: объявления верхнего уровня', () => {
    const symbols = scanSymbols(DOC);
    const names = symbols.map((s) => s.name);
    assert.deepEqual(names, ['helper', 'Point', 'Color', 'arithmetic', 'main']);
    assert.equal(findSymbol(symbols, 'helper').kind, 'fn');
    assert.equal(findSymbol(symbols, 'Point').kind, 'class');
    assert.equal(findSymbol(symbols, 'Color').kind, 'enum');
    assert.equal(findSymbol(symbols, 'arithmetic').kind, 'test');
});

test('scanSymbols: дети класса — поля и методы в правильном порядке', () => {
    const point = findSymbol(scanSymbols(DOC), 'Point');
    const children = point.children.map((c) => `${c.kind}:${c.name}`);
    assert.deepEqual(children, ['field:x', 'field:y', 'method:init', 'method:norm']);
    assert.match(findSymbol([point], 'init').detail, /fn init\(x, y\)/);
    assert.match(findSymbol([point], 'x').detail, /field x: int/);
});

test('scanSymbols: локальные переменные принадлежат функции', () => {
    const main = findSymbol(scanSymbols(DOC), 'main');
    const locals = main.children.filter((c) => c.kind === 'variable').map((c) => c.name);
    assert.deepEqual(locals, ['p', 'stack', 'ch']);
    assert.equal(main.children.find((c) => c.name === 'p').line, 28);
});

test('scanSymbols: скобки в строках и комментариях не ломают вложенность', () => {
    const text = 'fn a() {\n    print("} {");\n    // }\n}\n\nfn b() {}\n';
    const symbols = scanSymbols(text);
    assert.deepEqual(symbols.map((s) => s.name), ['a', 'b']);
});

test('scanSymbols: корректные range и selectionRange', () => {
    const helper = findSymbol(scanSymbols(DOC), 'helper');
    assert.deepEqual(helper.selectionRange.start, { line: 0, character: 3 });
    assert.deepEqual(helper.selectionRange.end, { line: 0, character: 9 });
    assert.equal(helper.range.start.line, 0);
    assert.ok(helper.range.end.line >= 2, 'range функции должен покрывать тело');
});

test('documentSymbol: LSP SymbolKind для каждого вида объявления', () => {
    const symbols = provideDocumentSymbols(DOC);
    const byName = new Map(symbols.map((s) => [s.name, s]));
    assert.equal(byName.get('helper').kind, 12, 'SymbolKind.Function');
    assert.equal(byName.get('Point').kind, 5, 'SymbolKind.Class');
    assert.equal(byName.get('Color').kind, 10, 'SymbolKind.Enum');
    assert.equal(byName.get('main').kind, 12);

    const point = byName.get('Point');
    const field = point.children.find((c) => c.name === 'x');
    const method = point.children.find((c) => c.name === 'init');
    assert.equal(field.kind, 8, 'SymbolKind.Field');
    assert.equal(method.kind, 6, 'SymbolKind.Method');

    const main = byName.get('main');
    assert.equal(main.children.find((c) => c.name === 'p').kind, 13, 'SymbolKind.Variable');
    // Служебные поля анализатора не должны утекать в LSP-ответ.
    assert.equal('_starts' in byName.get('helper'), false);
});

test('definition: функция, класс, enum, локальная переменная', () => {
    const uri = 'file:///doc.lat';
    const cases = [
        ['helper(p.x)', 1, 'helper', 0, 3],
        ['new Point(3, 4)', 5, 'Point', 4, 6],
        ['enum Color', 6, 'Color', 18, 5],
        ['helper(p.x)', 8, 'p', 28, 8],
    ];
    for (const [needle, inside, name, line, char] of cases) {
        const index = DOC.indexOf(needle);
        assert.ok(index >= 0, `маркер не найден: ${needle}`);
        const location = provideDefinition({ text: DOC, offset: index + inside, uri });
        assert.ok(location, `нет definition для ${name}`);
        assert.equal(location.uri, uri);
        assert.equal(location.range.start.line, line, `строка definition ${name}`);
        assert.equal(location.range.start.character, char, `столбец definition ${name}`);
        assert.equal(name.length > 0, true);
    }
});

test('definition: поле класса через this.', () => {
    const index = DOC.indexOf('this.x = x');
    const location = provideDefinition({
        text: DOC,
        offset: index + 'this.'.length + 1,
        uri: 'file:///doc.lat',
    });
    assert.ok(location, 'ожидался definition поля x');
    assert.equal(location.range.start.line, 5, 'поле x объявлено в классе (строка 6 → 5)');
});

test('definition: builtin/неизвестное имя → null', () => {
    const withPrint = 'fn main() { print("x"); }';
    const printIndex = withPrint.indexOf('print');
    assert.equal(provideDefinition({ text: withPrint, offset: printIndex + 1, uri: 'file:///d.lat' }),
        null, 'builtin не объявлен в файле — definition null');

    const unknown = 'fn main() { foo_bar(); }';
    assert.equal(provideDefinition({
        text: unknown,
        offset: unknown.indexOf('foo_bar') + 1,
        uri: 'file:///d.lat',
    }), null, 'неизвестное имя без объявления → null');
});

test('classOfVariable: new, массив, канал и аннотация', () => {
    const symbols = scanSymbols(DOC);
    assert.equal(classOfVariable(DOC, 'p', symbols), 'Point');
    assert.equal(classOfVariable(DOC, 'stack', symbols), 'array');
    assert.equal(classOfVariable(DOC, 'ch', symbols), 'channel');
    assert.equal(classOfVariable(DOC, 'missing', symbols), undefined);

    const annotated = 'class Foo { }\nfn main() {\n    let f: Foo = new Foo();\n}\n';
    assert.equal(classOfVariable(annotated, 'f', scanSymbols(annotated)), 'Foo');
});

test('enclosingClass: находит класс по смещению', () => {
    const symbols = scanSymbols(DOC);
    const inside = DOC.indexOf('this.x = x');
    const outside = DOC.indexOf('fn helper');
    assert.equal(enclosingClass(symbols, inside)?.name, 'Point');
    assert.equal(enclosingClass(symbols, outside), undefined);
});
