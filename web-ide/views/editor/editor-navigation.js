// views/editor/editor-navigation.js — клавиатурная навигация и правка кода.
// Единственная ответственность: стрелки, Backspace/Delete/Enter/Tab и ввод
// символов поверх модели `ed.code` (fallback, когда textarea не используется).
// Функции принимают экземпляр редактора `ed`.

import { ensureCursorVisible } from './editor-metrics.js';
import { render } from './editor-renderer.js';

const INDENT_UNIT = '    ';

export function handleKeyDown(ed, e) {
    const lines = ed.code.split('\n');
    let line = 0;
    let col = 0;
    let pos = 0;

    for (let i = 0; i < lines.length; i++) {
        if (pos + lines[i].length >= ed.cursorPos) {
            line = i;
            col = ed.cursorPos - pos;
            break;
        }
        pos += lines[i].length + 1;
    }

    switch (e.key) {
        case 'ArrowUp':
            if (line > 0) {
                ed.cursorPos = pos - lines[line - 1].length - 1 + Math.min(col, lines[line - 1].length);
            }
            e.preventDefault();
            break;
        case 'ArrowDown':
            if (line < lines.length - 1) {
                ed.cursorPos = pos + lines[line].length + 1 + Math.min(col, lines[line + 1].length);
            }
            e.preventDefault();
            break;
        case 'ArrowLeft':
            if (ed.cursorPos > 0) {
                ed.cursorPos--;
            }
            e.preventDefault();
            break;
        case 'ArrowRight':
            if (ed.cursorPos < ed.code.length) {
                ed.cursorPos++;
            }
            e.preventDefault();
            break;
        case 'Backspace':
            if (ed.cursorPos > 0) {
                ed.code = ed.code.slice(0, ed.cursorPos - 1) + ed.code.slice(ed.cursorPos);
                ed.cursorPos--;
                ed.textarea.value = ed.code;
            }
            e.preventDefault();
            break;
        case 'Delete':
            if (ed.cursorPos < ed.code.length) {
                ed.code = ed.code.slice(0, ed.cursorPos) + ed.code.slice(ed.cursorPos + 1);
                ed.textarea.value = ed.code;
            }
            e.preventDefault();
            break;
        case 'Enter':
            ed.code = ed.code.slice(0, ed.cursorPos) + '\n' + ed.code.slice(ed.cursorPos);
            ed.cursorPos++;
            ed.textarea.value = ed.code;
            e.preventDefault();
            break;
        case 'Tab':
            ed.code = ed.code.slice(0, ed.cursorPos) + INDENT_UNIT + ed.code.slice(ed.cursorPos);
            ed.cursorPos += INDENT_UNIT.length;
            ed.textarea.value = ed.code;
            e.preventDefault();
            break;
        default:
            if (e.key.length === 1) {
                ed.code = ed.code.slice(0, ed.cursorPos) + e.key + ed.code.slice(ed.cursorPos);
                ed.cursorPos++;
                ed.textarea.value = ed.code;
            }
            break;
    }

    // Автоскролл к курсору после любого изменения/навигации
    ensureCursorVisible(ed);
    render(ed);
}
