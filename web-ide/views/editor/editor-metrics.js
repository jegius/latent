// views/editor/editor-metrics.js — геометрия и позиция курсора редактора.
// Единственная ответственность: линия/колонка, максимумы скролла, автоскролл.
// Все функции принимают экземпляр редактора `ed` (не зависят от DOM напрямую).

/** Преобразует абсолютную позицию в (line, col). */
export function posToLineCol(ed, pos) {
    const lines = ed.code.split('\n');
    let remaining = pos;
    for (let i = 0; i < lines.length; i++) {
        const lineLen = lines[i].length + 1; // +1 на '\n'
        if (remaining < lineLen || i === lines.length - 1) {
            return { line: i, col: Math.min(remaining, lines[i].length) };
        }
        remaining -= lineLen;
    }
    return { line: 0, col: 0 };
}

// Максимальное значение вертикального скролла
export function getMaxScroll(ed) {
    const lines = ed.code.split('\n');
    const totalHeight = lines.length * ed.lineHeight;
    return Math.max(0, totalHeight - ed.canvas.height);
}

// Максимальное значение горизонтального скролла
export function getMaxScrollX(ed) {
    const lines = ed.code.split('\n');
    ed.ctx.font = ed.font;
    let maxWidth = 0;
    for (const line of lines) {
        const w = ed.ctx.measureText(line).width;
        if (w > maxWidth) maxWidth = w;
    }
    return Math.max(0, maxWidth - (ed.canvas.width - ed.scrollbarWidth - ed.gutterWidth));
}

// Автоскролл, чтобы курсор всегда был виден
export function ensureCursorVisible(ed) {
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

    const cursorY = line * ed.lineHeight;
    const visibleHeight = ed.canvas.height;

    if (cursorY < ed.scrollOffset) {
        ed.scrollOffset = cursorY;
    } else if (cursorY + ed.lineHeight > ed.scrollOffset + visibleHeight) {
        ed.scrollOffset = cursorY + ed.lineHeight - visibleHeight;
    }

    // Горизонтальный автоскролл
    ed.ctx.font = ed.font;
    const cursorX = ed.ctx.measureText(lines[line].slice(0, col)).width;
    const visibleWidth = ed.canvas.width - ed.scrollbarWidth - ed.gutterWidth;

    if (cursorX < ed.scrollOffsetX) {
        ed.scrollOffsetX = cursorX;
    } else if (cursorX > ed.scrollOffsetX + visibleWidth) {
        ed.scrollOffsetX = cursorX - visibleWidth;
    }

    // Синхронизируем скролл скрытого textarea, чтобы IME-кандидаты и
    // нативная каретка оставались у видимой позиции.
    if (ed.textarea) {
        ed.textarea.scrollTop = ed.scrollOffset;
        ed.textarea.scrollLeft = ed.scrollOffsetX;
    }
}