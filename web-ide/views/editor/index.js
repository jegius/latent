// views/editor/index.js — фасад canvas-редактора.
// Единственная ответственность: композиция подмодулей и публичный API CanvasEditor.

import {
    EDITOR_THEME, LINE_NUMBER_COLOR, LINE_NUMBER_ACTIVE_COLOR, CURRENT_LINE_HIGHLIGHT,
} from './editor-theme.js';
import { posToLineCol, getMaxScroll, getMaxScrollX, ensureCursorVisible } from './editor-metrics.js';
import { render } from './editor-renderer.js';
import {
    setupTextareaInput, handleWheel, isOnScrollbar,
    handleMouseDown, handleMouseMove, handleMouseUp, handleClick, handleKeyDown,
} from './editor-input.js';

/**
 * Канвас-редактор кода (слой отображения).
 * Отвечает только за рендеринг, ввод и навигацию. Бизнес-логика — вне класса.
 */
export class CanvasEditor {
    constructor(canvasId, textareaId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.textarea = document.getElementById(textareaId);
        this.code = '';
        this.cursorPos = 0;
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.scrollOffset = 0;
        this.scrollOffsetX = 0;
        this.lineHeight = 20;
        this.charWidth = 8;
        this.font = '14px "Fira Code", "Cascadia Code", monospace';
        // Параметры скроллбара
        this.scrollbarWidth = 12;
        this.scrollbarDragging = false;
        this.scrollbarDragStartY = 0;
        this.scrollbarDragStartOffset = 0;
        // Гуттер с номерами строк (как в IntelliJ IDEA)
        this.gutterWidth = 56;
        this.lineNumberColor = LINE_NUMBER_COLOR;
        this.lineNumberActiveColor = LINE_NUMBER_ACTIVE_COLOR;
        this.currentLineHighlight = CURRENT_LINE_HIGHLIGHT;
        // Слушатели изменения текста (hot reload и т.п.)
        this.changeHandlers = [];
        // Защита от рекурсии при синхронизации textarea ↔ code
        this.suppressTextareaSync = false;
        this.theme = { ...EDITOR_THEME };

        this.init();
    }

    init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.setAttribute('tabindex', '0');

        // Скролл колесом мыши
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

        // Перетаскивание скроллбара
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', () => this.handleMouseUp());

        this.setupTextareaInput();
        this.render();
    }

    // ---- Композиция подмодулей (единая точка DOM-привязки) ----
    setupTextareaInput() { setupTextareaInput(this); }
    render() { render(this); }
    ensureCursorVisible() { ensureCursorVisible(this); }
    getMaxScroll() { return getMaxScroll(this); }
    getMaxScrollX() { return getMaxScrollX(this); }
    isOnScrollbar(x, y) { return isOnScrollbar(this, x, y); }
    handleWheel(e) { handleWheel(this, e); }
    handleMouseDown(e) { handleMouseDown(this, e); }
    handleMouseMove(e) { handleMouseMove(this, e); }
    handleMouseUp() { handleMouseUp(this); }
    handleClick(e) { handleClick(this, e); }
    handleKeyDown(e) { handleKeyDown(this, e); }

    syncFromTextarea() {
        if (this.suppressTextareaSync) return;
        this.code = this.textarea.value;
        this.cursorPos = this.textarea.selectionStart;
        this.selectionStart = this.textarea.selectionStart;
        this.selectionEnd = this.textarea.selectionEnd;
        this.ensureCursorVisible();
        this.render();
        this.emitChange();
    }

    syncSelectionFromTextarea() {
        this.cursorPos = this.textarea.selectionStart;
        this.selectionStart = this.textarea.selectionStart;
        this.selectionEnd = this.textarea.selectionEnd;
        this.render();
    }

    /**
     * Регистрирует слушателя изменения текста.
     * @param {() => void} handler
     */
    onChange(handler) {
        this.changeHandlers.push(handler);
    }

    emitChange() {
        for (const h of this.changeHandlers) h();
    }

    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.render();
    }

    setCode(code) {
        this.code = code;
        if (this.textarea) {
            this.suppressTextareaSync = true;
            this.textarea.value = code;
            this.suppressTextareaSync = false;
        }
        this.cursorPos = 0;
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.scrollOffset = 0;
        this.scrollOffsetX = 0;
        if (this.textarea) {
            this.textarea.scrollTop = 0;
            this.textarea.scrollLeft = 0;
        }
        this.render();
    }

    getCode() {
        return this.code;
    }

    /** Фокусирует скрытый textarea (для ввода). */
    focus() {
        if (this.textarea) this.textarea.focus();
    }

    /** Преобразует абсолютную позицию в (line, col). */
    posToLineCol(pos) {
        return posToLineCol(this, pos);
    }
}