// views/editor/editor-input.js — ввод с клавиатуры и textarea-синхронизация.
// Единственная ответственность: настройка скрытого textarea и автоправки
// (Tab/Enter/парные скобки). Мышь и скролл — editor-pointer.js, стрелки и
// правка модели — editor-navigation.js. Функции принимают экземпляр `ed`.

import { render } from './editor-renderer.js';

/**
 * Скрытый textarea — единственный источник ввода. Он даёт бесплатно каретку,
 * выделение, undo и, главное, IME (composition events) — без него не работает
 * ввод кириллицы (§6.2 статьи). Canvas только рисует.
 */
export function setupTextareaInput(ed) {
    const ta = ed.textarea;
    if (!ta) return;
    ta.style.position = 'absolute';
    ta.style.inset = '0';
    ta.style.width = '100%';
    ta.style.height = '100%';
    ta.style.opacity = '0';
    ta.style.resize = 'none';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.overflow = 'hidden';
    ta.style.zIndex = '2';
    ta.style.caretColor = 'transparent';
    // Геометрия нативной каретки должна совпадать с отрисовкой canvas:
    // текст начинается справа от гуттера и использует тот же шрифт/интерлиньяж.
    // Без этого клик по строке давал смещение вправо (курсор «уезжал» в конец).
    ta.style.paddingLeft = ed.gutterWidth + 'px';
    ta.style.paddingTop = '0px';
    ta.style.paddingRight = (ed.scrollbarWidth + 2) + 'px';
    ta.style.paddingBottom = (ed.scrollbarWidth + 2) + 'px';
    ta.style.margin = '0';
    ta.style.font = ed.font;
    ta.style.lineHeight = ed.lineHeight + 'px';
    ta.style.whiteSpace = 'pre';
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('wrap', 'off');

    ta.addEventListener('input', () => ed.syncFromTextarea());
    ta.addEventListener('scroll', () => {
        // textarea скроллится сам (для каретки/IME); отражаем в canvas
        ed.scrollOffset = ta.scrollTop;
        ed.scrollOffsetX = ta.scrollLeft;
        render(ed);
    });
    // keyup/click — обновить позицию каретки/выделение (стрелки не всегда дают input)
    ta.addEventListener('keyup', () => ed.syncSelectionFromTextarea());
    ta.addEventListener('click', () => ed.syncSelectionFromTextarea());
    ta.addEventListener('select', () => ed.syncSelectionFromTextarea());

    // Автоотступ на Enter, вставка пробелов на Tab, авто-открытие/закрытие пар.
    ta.addEventListener('keydown', (e) => handleEditorKeyDown(ed, e));
}

const INDENT_UNIT = '    ';
const PAIRS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);

/**
 * Обрабатывает клавиши редактирования: Tab, Enter (автоотступ), кавычки/скобки.
 * Работает с нативным textarea, поэтому сохраняется undo и IME.
 * @param {import('./index.js').CanvasEditor} ed
 * @param {KeyboardEvent} e
 */
function handleEditorKeyDown(ed, e) {
    const ta = ed.textarea;
    if (!ta) return;

    // Tab — вставка отступа (или сдвиг выделения). Shift+Tab — обратное.
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const value = ta.value;

        if (start !== end && value.slice(start, end).includes('\n')) {
            // Многострочное выделение: сдвигаем строки целиком
            const before = value.slice(0, start);
            const block = value.slice(start, end);
            const after = value.slice(end);
            const lines = block.split('\n');
            const shifted = lines.map(l => e.shiftKey ? outdent(l) : (INDENT_UNIT + l));
            const newBlock = shifted.join('\n');
            ta.value = before + newBlock + after;
            ta.setSelectionRange(start, start + newBlock.length);
        } else {
            insertText(ed, e.shiftKey ? '' : INDENT_UNIT, e.shiftKey);
        }
        ed.syncFromTextarea();
        return;
    }

    // Enter — автоотступ по текущей строке (+1 уровень после открывающей скобки).
    if (e.key === 'Enter') {
        e.preventDefault();
        const value = ta.value;
        const pos = ta.selectionStart;
        const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
        const lineText = value.slice(lineStart, pos);
        let indent = (lineText.match(/^[ \t]*/) || [''])[0];
        const trimmed = lineText.replace(/[ \t]+$/, '');
        const lastChar = trimmed[trimmed.length - 1];
        const nextChar = value[pos] || '';

        if (lastChar === '{' || lastChar === '(' || lastChar === '[') {
            indent += INDENT_UNIT;
        }
        // Enter между парой скобок: раздвигаем их и ставим курсор в середину
        if ((lastChar === '{' && nextChar === '}') || (lastChar === '(' && nextChar === ')')
            || (lastChar === '[' && nextChar === ']')) {
            const inner = indent;
            const outer = indent.slice(0, Math.max(0, indent.length - INDENT_UNIT.length));
            const inserted = '\n' + inner + '\n' + outer;
            ta.value = value.slice(0, pos) + inserted + value.slice(pos);
            ta.setSelectionRange(pos + 1 + inner.length, pos + 1 + inner.length);
            ed.syncFromTextarea();
            return;
        }
        insertText(ed, '\n' + indent);
        return;
    }

    // Скобки и кавычки: вставка пары с курсором внутри (при выделении — обёртка).
    if (PAIRS[e.key] && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const value = ta.value;
        const selected = value.slice(start, end);
        const pair = e.key + PAIRS[e.key];
        ta.value = value.slice(0, start) + e.key + selected + PAIRS[e.key] + value.slice(end);
        if (selected) {
            ta.setSelectionRange(start + 1, start + 1 + selected.length);
        } else {
            ta.setSelectionRange(start + 1, start + 1);
        }
        ed.syncFromTextarea();
        return;
    }

    // Закрывающая скобка поверх уже вставленной пары — просто перешагнуть её.
    if (CLOSERS.has(e.key) && !e.metaKey && !e.ctrlKey) {
        const pos = ta.selectionStart;
        if (pos === ta.selectionEnd && ta.value[pos] === e.key) {
            e.preventDefault();
            ta.setSelectionRange(pos + 1, pos + 1);
            ed.syncSelectionFromTextarea();
        }
    }
}

/** Убирает один уровень отступа слева строки. */
function outdent(line) {
    if (line.startsWith('\t')) return line.slice(1);
    let removed = 0;
    while (removed < INDENT_UNIT.length && line[removed] === ' ') removed++;
    return line.slice(removed);
}

/**
 * Вставляет текст в текущую позицию textarea, заменяя выделение.
 * @param {import('./index.js').CanvasEditor} ed
 * @param {string} text
 */
function insertText(ed, text) {
    const ta = ed.textarea;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    const caret = start + text.length;
    ta.setSelectionRange(caret, caret);
}
