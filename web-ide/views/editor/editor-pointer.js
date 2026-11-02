// views/editor/editor-pointer.js — мышь, колесо и скроллбары редактора.
// Единственная ответственность: скролл колесом, перетаскивание ползунка
// и позиционирование каретки по клику. Функции принимают экземпляр `ed`.

import { getMaxScroll, getMaxScrollX, ensureCursorVisible } from './editor-metrics.js';
import { render } from './editor-renderer.js';

// Обработчик колеса мыши — вертикальный и горизонтальный скролл
export function handleWheel(ed, e) {
    e.preventDefault();
    const delta = e.deltaY;
    const deltaX = e.deltaX;

    if (e.shiftKey || Math.abs(deltaX) > Math.abs(delta)) {
        // Горизонтальный скролл
        ed.scrollOffsetX = Math.max(0, Math.min(getMaxScrollX(ed), ed.scrollOffsetX + (deltaX || delta)));
    } else {
        // Вертикальный скролл
        ed.scrollOffset = Math.max(0, Math.min(getMaxScroll(ed), ed.scrollOffset + delta));
    }
    render(ed);
}

// Проверка, попал ли клик на вертикальный скроллбар
export function isOnScrollbar(ed, x, y) {
    if (getMaxScroll(ed) <= 0) return false;
    return x >= ed.canvas.width - ed.scrollbarWidth;
}

export function handleMouseDown(ed, e) {
    const rect = ed.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isOnScrollbar(ed, x, y)) {
        const maxScroll = getMaxScroll(ed);
        const trackHeight = ed.canvas.height;
        const thumbHeight = Math.max(30, trackHeight * (ed.canvas.height / (ed.canvas.height + maxScroll)));
        const thumbY = (ed.scrollOffset / maxScroll) * (trackHeight - thumbHeight);

        if (y >= thumbY && y <= thumbY + thumbHeight) {
            // Начинаем перетаскивание ползунка
            ed.scrollbarDragging = true;
            ed.scrollbarDragStartY = y;
            ed.scrollbarDragStartOffset = ed.scrollOffset;
        } else {
            // Клик по треку — прыжок к позиции
            const ratio = y / trackHeight;
            ed.scrollOffset = ratio * maxScroll;
            render(ed);
        }
        e.preventDefault();
    }
}

export function handleMouseMove(ed, e) {
    if (!ed.scrollbarDragging) return;
    const rect = ed.canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;

    const maxScroll = getMaxScroll(ed);
    const trackHeight = ed.canvas.height;
    const thumbHeight = Math.max(30, trackHeight * (ed.canvas.height / (ed.canvas.height + maxScroll)));
    const deltaY = y - ed.scrollbarDragStartY;
    const scrollDelta = (deltaY / (trackHeight - thumbHeight)) * maxScroll;

    ed.scrollOffset = Math.max(0, Math.min(maxScroll, ed.scrollbarDragStartOffset + scrollDelta));
    render(ed);
}

export function handleMouseUp(ed) {
    ed.scrollbarDragging = false;
}

export function handleClick(ed, e) {
    const rect = ed.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Клик по скроллбару обрабатывается в handleMouseDown
    if (isOnScrollbar(ed, x, y)) return;
    // Клик по гуттеру с номерами строк — не перемещает каретку
    if (x < ed.gutterWidth) {
        if (ed.textarea) ed.textarea.focus();
        return;
    }

    const line = Math.floor(y / ed.lineHeight) + Math.floor(ed.scrollOffset / ed.lineHeight);
    const lines = ed.code.split('\n');
    if (line < lines.length) {
        const lineText = lines[line];
        // Вычисляем колонку по реальной ширине текста с учётом гуттера и скролла
        ed.ctx.font = ed.font;
        const clickX = x - ed.gutterWidth + ed.scrollOffsetX;
        let col = 0;
        let accWidth = 0;
        for (let i = 0; i < lineText.length; i++) {
            const w = ed.ctx.measureText(lineText[i]).width;
            if (accWidth + w / 2 >= clickX) break;
            accWidth += w;
            col = i + 1;
        }

        let pos = 0;
        for (let i = 0; i < line; i++) {
            pos += lines[i].length + 1;
        }
        pos += Math.min(col, lineText.length);
        ed.cursorPos = pos;
        ed.selectionStart = pos;
        ed.selectionEnd = pos;

        // Синхронизируем каретку скрытого textarea и фокусируем его для ввода/IME
        if (ed.textarea) {
            ed.suppressTextareaSync = true;
            ed.textarea.focus();
            ed.textarea.setSelectionRange(pos, pos);
            ed.suppressTextareaSync = false;
        }
    }

    ensureCursorVisible(ed);
    render(ed);
}
