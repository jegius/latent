// views/editor/editor-renderer.js — отрисовка editor-canvas.
// Единственная ответственность: рисование фона, текста, гуттера, каретки, скроллбаров.
// Функции принимают экземпляр редактора `ed`.

import { getMaxScroll, getMaxScrollX, posToLineCol } from './editor-metrics.js';
import { tokenizeLine } from './line-tokenizer.js';

export function render(ed) {
    const width = ed.canvas.width;
    const height = ed.canvas.height;

    ed.ctx.fillStyle = ed.theme.background;
    ed.ctx.fillRect(0, 0, width, height);

    ed.ctx.font = ed.font;
    ed.ctx.textBaseline = 'top';

    const lines = ed.code.split('\n');
    const startLine = Math.floor(ed.scrollOffset / ed.lineHeight);
    const endLine = Math.min(startLine + Math.ceil(height / ed.lineHeight), lines.length);

    const gutter = ed.gutterWidth;
    const textOriginX = gutter;
    const textAreaWidth = width - ed.scrollbarWidth;

    // Позиция курсора (строка/колонка) — нужна для подсветки текущей строки
    const cursorLC = posToLineCol(ed, ed.cursorPos);

    // --- 1. Подсветка текущей строки (как в IntelliJ) ---
    if (cursorLC.line >= startLine && cursorLC.line < endLine) {
        const y = (cursorLC.line - startLine) * ed.lineHeight;
        ed.ctx.fillStyle = ed.theme.currentLine;
        ed.ctx.fillRect(gutter, y, textAreaWidth - gutter, ed.lineHeight);
    }

    // --- 2. Текст (клиппинг по области справа от гуттера) ---
    ed.ctx.save();
    ed.ctx.beginPath();
    ed.ctx.rect(textOriginX, 0, textAreaWidth - textOriginX, height);
    ed.ctx.clip();

    if (ed.selectionEnd > ed.selectionStart) {
        renderSelection(ed, lines, startLine, endLine, textOriginX);
    }

    for (let i = startLine; i < endLine; i++) {
        const y = (i - startLine) * ed.lineHeight;
        const tokens = tokenizeLine(lines[i]);
        let x = textOriginX - ed.scrollOffsetX;

        for (const token of tokens) {
            ed.ctx.fillStyle = ed.theme[token.type] || ed.theme.text;
            ed.ctx.fillText(token.text, x, y);
            x += ed.ctx.measureText(token.text).width;
        }
    }

    // Каретка
    if (cursorLC.line >= startLine && cursorLC.line < endLine) {
        const cursorY = (cursorLC.line - startLine) * ed.lineHeight;
        const cursorX = textOriginX
            - ed.scrollOffsetX
            + ed.ctx.measureText(lines[cursorLC.line].slice(0, cursorLC.col)).width;
        ed.ctx.fillStyle = ed.theme.cursor;
        ed.ctx.fillRect(cursorX, cursorY, 2, ed.lineHeight);
    }

    ed.ctx.restore();

    // --- 3. Гуттер с номерами строк (поверх фона, но под текстом не нужен) ---
    ed.ctx.fillStyle = ed.theme.gutter;
    ed.ctx.fillRect(0, 0, gutter, height);
    // Разделительная линия гуттера
    ed.ctx.fillStyle = '#2b2d30';
    ed.ctx.fillRect(gutter - 1, 0, 1, height);

    ed.ctx.textAlign = 'right';
    for (let i = startLine; i < endLine; i++) {
        const y = (i - startLine) * ed.lineHeight;
        ed.ctx.fillStyle = (i === cursorLC.line)
            ? ed.lineNumberActiveColor
            : ed.lineNumberColor;
        ed.ctx.fillText(String(i + 1), gutter - 12, y + 2);
    }
    ed.ctx.textAlign = 'left';

    // --- 4. Скроллбары ---
    renderScrollbars(ed);
}

/** Рисует прямоугольники выделения по строкам. */
export function renderSelection(ed, lines, startLine, endLine, originX = 0) {
    const from = posToLineCol(ed, ed.selectionStart);
    const to = posToLineCol(ed, ed.selectionEnd);
    ed.ctx.font = ed.font;
    ed.ctx.fillStyle = ed.theme.selection;

    for (let i = from.line; i <= to.line && i < lines.length; i++) {
        if (i < startLine || i >= endLine) continue;
        const lineText = lines[i];
        const cStart = i === from.line ? from.col : 0;
        const cEnd = i === to.line ? to.col : lineText.length;
        const x1 = originX - ed.scrollOffsetX + ed.ctx.measureText(lineText.slice(0, cStart)).width;
        const x2 = originX - ed.scrollOffsetX + ed.ctx.measureText(lineText.slice(0, cEnd)).width;
        const y = (i - startLine) * ed.lineHeight;
        const w = Math.max(x2 - x1, cStart === cEnd ? ed.ctx.measureText(' ').width : 0);
        ed.ctx.fillRect(x1, y, w, ed.lineHeight);
    }
}

// Отрисовка вертикального и горизонтального скроллбаров
export function renderScrollbars(ed) {
    const maxScroll = getMaxScroll(ed);
    const maxScrollX = getMaxScrollX(ed);

    // Вертикальный скроллбар
    if (maxScroll > 0) {
        const trackX = ed.canvas.width - ed.scrollbarWidth;
        const trackHeight = ed.canvas.height;
        const thumbHeight = Math.max(30, trackHeight * (ed.canvas.height / (ed.canvas.height + maxScroll)));
        const thumbY = (ed.scrollOffset / maxScroll) * (trackHeight - thumbHeight);

        // Трек
        ed.ctx.fillStyle = '#2d2d30';
        ed.ctx.fillRect(trackX, 0, ed.scrollbarWidth, trackHeight);

        // Ползунок
        ed.ctx.fillStyle = ed.scrollbarDragging ? '#5a5a5a' : '#424242';
        ed.ctx.fillRect(trackX + 1, thumbY, ed.scrollbarWidth - 2, thumbHeight);
    }

    // Горизонтальный скроллбар
    if (maxScrollX > 0) {
        const trackY = ed.canvas.height - ed.scrollbarWidth;
        const trackWidth = ed.canvas.width - ed.scrollbarWidth;
        const thumbWidth = Math.max(30, trackWidth * (trackWidth / (trackWidth + maxScrollX)));
        const thumbX = (ed.scrollOffsetX / maxScrollX) * (trackWidth - thumbWidth);

        // Трек
        ed.ctx.fillStyle = '#2d2d30';
        ed.ctx.fillRect(0, trackY, trackWidth, ed.scrollbarWidth);

        // Ползунок
        ed.ctx.fillStyle = '#424242';
        ed.ctx.fillRect(thumbX, trackY + 1, thumbWidth, ed.scrollbarWidth - 2);
    }
}