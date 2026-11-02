import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

const pkg = readJson('package.json');
const languageConfiguration = readJson('language-configuration.json');
const grammar = readJson('syntaxes/latent.tmLanguage.json');
const snippets = readJson('snippets/latent.json');

const COMMAND_IDS = [
    'latent.compile',
    'latent.run',
    'latent.check',
    'latent.format',
    'latent.openDocs',
    'latent.openPlayground',
    'latent.restartLsp',
];

const CONFIGURATION_KEYS = [
    'latent.latentcPath',
    'latent.nodePath',
    'latent.lspServerPath',
    'latent.compilerWasmPath',
    'latent.enableDiagnostics',
    'latent.enableLsp',
    'latent.formatOnSave',
];

test('package.json: обязательные поля манифеста', () => {
    assert.equal(pkg.name, 'latent-lang');
    assert.equal(pkg.publisher, 'jegius');
    assert.equal(pkg.displayName, 'Latent Language');
    assert.equal(pkg.version, '1.0.0');
    assert.equal(pkg.engines.vscode, '^1.85.0');
    assert.equal(pkg.main, './src/extension.js');
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.icon, 'images/icon.png');
    assert.ok(pkg.repository && pkg.repository.url.includes('github.com/jegius/latent'));
    assert.deepEqual(pkg.categories, ['Programming Languages', 'Snippets', 'Linters']);
});

test('package.json: activationEvents включает язык и все команды', () => {
    assert.ok(Array.isArray(pkg.activationEvents));
    assert.ok(pkg.activationEvents.includes('onLanguage:latent'));
    for (const id of COMMAND_IDS) {
        assert.ok(pkg.activationEvents.includes(`onCommand:${id}`), `нет onCommand:${id}`);
    }
});

test('package.json: language contribution корректен', () => {
    const languages = pkg.contributes.languages;
    assert.equal(languages.length, 1);
    const language = languages[0];
    assert.equal(language.id, 'latent');
    assert.deepEqual(language.extensions, ['.lat']);
    assert.ok(language.aliases.includes('Latent'));
    assert.equal(language.configuration, './language-configuration.json');
});

test('package.json: грамматика указывает на существующий JSON', () => {
    const grammars = pkg.contributes.grammars;
    assert.equal(grammars.length, 1);
    assert.equal(grammars[0].language, 'latent');
    assert.equal(grammars[0].scopeName, 'source.latent');
    assert.equal(grammars[0].path, './syntaxes/latent.tmLanguage.json');
    assert.ok(fs.existsSync(path.join(root, grammars[0].path)));
    assert.equal(grammar.scopeName, 'source.latent');
    assert.equal(grammar.name, 'Latent');
});

test('package.json: сниппеты и language-configuration существуют', () => {
    const snippetsContribution = pkg.contributes.snippets;
    assert.equal(snippetsContribution.length, 1);
    assert.equal(snippetsContribution[0].language, 'latent');
    assert.equal(snippetsContribution[0].path, './snippets/latent.json');
    assert.ok(fs.existsSync(path.join(root, snippetsContribution[0].path)));
    assert.ok(Object.keys(snippets).length > 0);
    assert.equal(languageConfiguration.comments.lineComment, '//');
});

test('package.json: команды объявлены, уникальны и имеют заголовки', () => {
    const commands = pkg.contributes.commands;
    assert.ok(Array.isArray(commands));
    const ids = commands.map((command) => command.command);
    assert.deepEqual([...new Set(ids)], ids, 'команды дублируются');
    for (const id of COMMAND_IDS) {
        assert.ok(ids.includes(id), `команда ${id} не объявлена`);
    }
    for (const command of commands) {
        assert.ok(command.title && command.title.length > 2, `пустой заголовок ${command.command}`);
        assert.equal(command.category, 'Latent');
    }
});

test('package.json: keybindings ссылаются на объявленные команды', () => {
    const declared = new Set(pkg.contributes.commands.map((command) => command.command));
    const keybindings = pkg.contributes.keybindings;
    assert.ok(Array.isArray(keybindings) && keybindings.length >= 5);
    const bound = new Set();
    for (const binding of keybindings) {
        assert.ok(declared.has(binding.command), `keybinding для неизвестной команды ${binding.command}`);
        assert.ok(typeof binding.key === 'string' && binding.key.length > 0);
        assert.ok(typeof binding.mac === 'string' && binding.mac.length > 0);
        bound.add(binding.command);
    }
    for (const id of ['latent.run', 'latent.compile', 'latent.check', 'latent.format']) {
        assert.ok(bound.has(id), `нет горячей клавиши для ${id}`);
        const binding = keybindings.find((item) => item.command === id);
        assert.equal(binding.when, 'editorLangId == latent');
    }
});

test('package.json: menus содержат editor/title, commandPalette и editor/context', () => {
    const declared = new Set(pkg.contributes.commands.map((command) => command.command));
    const menus = pkg.contributes.menus;
    assert.ok(Array.isArray(menus['editor/title']));
    assert.ok(Array.isArray(menus.commandPalette));
    assert.ok(Array.isArray(menus['editor/context']));

    const title = menus['editor/title'];
    assert.ok(title.some((item) => item.command === 'latent.run' && item.when === 'editorLangId == latent'));
    assert.ok(title.some((item) => item.command === 'latent.compile'));

    for (const key of ['editor/title', 'commandPalette', 'editor/context']) {
        for (const item of menus[key]) {
            assert.ok(declared.has(item.command), `${key}: неизвестная команда ${item.command}`);
        }
    }

    const paletteCommands = menus.commandPalette.map((item) => item.command);
    for (const id of COMMAND_IDS) {
        assert.ok(paletteCommands.includes(id), `команда ${id} отсутствует в commandPalette`);
    }
    const contextCommands = menus['editor/context'].map((item) => item.command);
    for (const id of ['latent.run', 'latent.compile', 'latent.check', 'latent.format', 'latent.openDocs', 'latent.openPlayground']) {
        assert.ok(contextCommands.includes(id), `команда ${id} отсутствует в editor/context`);
    }
});

test('package.json: все настройки объявлены с корректными типами', () => {
    const properties = pkg.contributes.configuration.properties;
    assert.ok(properties);
    assert.deepEqual(Object.keys(properties).sort(), [...CONFIGURATION_KEYS].sort());
    for (const key of CONFIGURATION_KEYS) {
        const property = properties[key];
        assert.ok(['string', 'boolean'].includes(property.type), `неверный тип ${key}`);
        assert.ok(property.description || property.markdownDescription, `нет описания ${key}`);
    }
    for (const key of ['latent.enableDiagnostics', 'latent.enableLsp', 'latent.formatOnSave']) {
        assert.equal(properties[key].type, 'boolean');
        assert.equal(typeof properties[key].default, 'boolean');
    }
    for (const key of ['latent.latentcPath', 'latent.nodePath', 'latent.lspServerPath', 'latent.compilerWasmPath']) {
        assert.equal(properties[key].type, 'string');
        assert.equal(properties[key].default, '');
    }
    assert.equal(properties['latent.enableDiagnostics'].default, true);
    assert.equal(properties['latent.enableLsp'].default, true);
    assert.equal(properties['latent.formatOnSave'].default, false);
});

test('package.json: main, README, LICENSE и иконка существуют', () => {
    assert.ok(fs.existsSync(path.join(root, pkg.main)), 'нет main');
    assert.ok(fs.existsSync(path.join(root, 'README.md')));
    assert.ok(fs.existsSync(path.join(root, 'LICENSE')));
    assert.ok(fs.existsSync(path.join(root, pkg.icon)), 'нет иконки');
    assert.ok(fs.existsSync(path.join(root, 'language-configuration.json')));
    const icon = fs.readFileSync(path.join(root, pkg.icon));
    assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(icon.length > 500);
});

test('package.json: files ограничивает содержимое VSIX и не включает тесты', () => {
    assert.ok(Array.isArray(pkg.files));
    for (const required of ['src/**', 'syntaxes/**', 'snippets/**', 'images/**',
        'language-configuration.json', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
        assert.ok(pkg.files.includes(required), `files не содержит ${required}`);
    }
    assert.ok(!pkg.files.some((entry) => entry.startsWith('test')), 'тесты не должны попадать в VSIX');
    assert.ok(!pkg.files.some((entry) => entry.includes('vsix')));
});
