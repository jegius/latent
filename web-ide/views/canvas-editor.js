// views/canvas-editor.js — канвас-редактор кода (слой отображения).
// Отвечает только за рендеринг, ввод и навигацию по тексту.
// Не содержит бизнес-логики компиляции или AI.

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
        this.scrollbarWidth = 10;
        this.scrollbarDragging = false;
        this.scrollbarDragStartY = 0;
        this.scrollbarDragStartOffset = 0;
        this.theme = {
            background: '#1e1e1e',
            text: '#d4d4d4',
            keyword: '#569cd6',
            type: '#4ec9b0',
            builtin: '#dcdcaa',
            number: '#b5cea8',
            string: '#ce9178',
            comment: '#6a9955',
            operator: '#d4d4d4',
            variable: '#9cdcfe',
            cursor: '#aeafad',
            selection: '#264f78'
        };

        this.keywords = new Set([
            'fn', 'let', 'if', 'else', 'while', 'for', 'in', 'return',
            'class', 'new', 'this', 'match', 'case', 'spawn', 'select',
            'async', 'await', 'yield', 'true', 'false', 'null'
        ]);

        this.types = new Set(['int', 'float', 'bool', 'string', 'void']);
        this.builtins = new Set(['print', 'channel', 'ai', 'Embedding', 'Model', 'Result', 'Option', 'Promise', 'Some', 'None', 'Ok', 'Err']);

        this.init();
    }

    init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('keydown', (e) => this.handleKeyDown(e));
        this.canvas.setAttribute('tabindex', '0');

        // Скролл колесом мыши
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

        // Перетаскивание скроллбара
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', () => this.handleMouseUp());

        this.render();
    }

    // Максимальное значение вертикального скролла
    getMaxScroll() {
        const lines = this.code.split('\n');
        const totalHeight = lines.length * this.lineHeight;
        return Math.max(0, totalHeight - this.canvas.height);
    }

    // Максимальное значение горизонтального скролла
    getMaxScrollX() {
        const lines = this.code.split('\n');
        this.ctx.font = this.font;
        let maxWidth = 0;
        for (const line of lines) {
            const w = this.ctx.measureText(line).width;
            if (w > maxWidth) maxWidth = w;
        }
        return Math.max(0, maxWidth - (this.canvas.width - this.scrollbarWidth));
    }

    // Обработчик колеса мыши — вертикальный и горизонтальный скролл
    handleWheel(e) {
        e.preventDefault();
        const delta = e.deltaY;
        const deltaX = e.deltaX;

        if (e.shiftKey || Math.abs(deltaX) > Math.abs(delta)) {
            // Горизонтальный скролл
            this.scrollOffsetX = Math.max(0, Math.min(this.getMaxScrollX(), this.scrollOffsetX + (deltaX || delta)));
        } else {
            // Вертикальный скролл
            this.scrollOffset = Math.max(0, Math.min(this.getMaxScroll(), this.scrollOffset + delta));
        }
        this.render();
    }

    // Проверка, попал ли клик на вертикальный скроллбар
    isOnScrollbar(x, y) {
        if (this.getMaxScroll() <= 0) return false;
        return x >= this.canvas.width - this.scrollbarWidth;
    }

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.isOnScrollbar(x, y)) {
            const maxScroll = this.getMaxScroll();
            const trackHeight = this.canvas.height;
            const thumbHeight = Math.max(30, trackHeight * (this.canvas.height / (this.canvas.height + maxScroll)));
            const thumbY = (this.scrollOffset / maxScroll) * (trackHeight - thumbHeight);

            if (y >= thumbY && y <= thumbY + thumbHeight) {
                // Начинаем перетаскивание ползунка
                this.scrollbarDragging = true;
                this.scrollbarDragStartY = y;
                this.scrollbarDragStartOffset = this.scrollOffset;
            } else {
                // Клик по треку — прыжок к позиции
                const ratio = y / trackHeight;
                this.scrollOffset = ratio * maxScroll;
                this.render();
            }
            e.preventDefault();
        }
    }

    handleMouseMove(e) {
        if (!this.scrollbarDragging) return;
        const rect = this.canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;

        const maxScroll = this.getMaxScroll();
        const trackHeight = this.canvas.height;
        const thumbHeight = Math.max(30, trackHeight * (this.canvas.height / (this.canvas.height + maxScroll)));
        const deltaY = y - this.scrollbarDragStartY;
        const scrollDelta = (deltaY / (trackHeight - thumbHeight)) * maxScroll;

        this.scrollOffset = Math.max(0, Math.min(maxScroll, this.scrollbarDragStartOffset + scrollDelta));
        this.render();
    }

    handleMouseUp() {
        this.scrollbarDragging = false;
    }

    // Автоскролл, чтобы курсор всегда был виден
    ensureCursorVisible() {
        const lines = this.code.split('\n');
        let line = 0;
        let col = 0;
        let pos = 0;
        for (let i = 0; i < lines.length; i++) {
            if (pos + lines[i].length >= this.cursorPos) {
                line = i;
                col = this.cursorPos - pos;
                break;
            }
            pos += lines[i].length + 1;
        }

        const cursorY = line * this.lineHeight;
        const visibleHeight = this.canvas.height;

        if (cursorY < this.scrollOffset) {
            this.scrollOffset = cursorY;
        } else if (cursorY + this.lineHeight > this.scrollOffset + visibleHeight) {
            this.scrollOffset = cursorY + this.lineHeight - visibleHeight;
        }

        // Горизонтальный автоскролл
        this.ctx.font = this.font;
        const cursorX = this.ctx.measureText(lines[line].slice(0, col)).width;
        const visibleWidth = this.canvas.width - this.scrollbarWidth;

        if (cursorX < this.scrollOffsetX) {
            this.scrollOffsetX = cursorX;
        } else if (cursorX > this.scrollOffsetX + visibleWidth) {
            this.scrollOffsetX = cursorX - visibleWidth;
        }
    }

    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.render();
    }

    setCode(code) {
        this.code = code;
        this.textarea.value = code;
        this.render();
    }

    getCode() {
        return this.code;
    }

    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Клик по скроллбару обрабатывается в handleMouseDown
        if (this.isOnScrollbar(x, y)) return;

        const line = Math.floor(y / this.lineHeight) + Math.floor(this.scrollOffset / this.lineHeight);
        const lines = this.code.split('\n');
        if (line < lines.length) {
            const lineText = lines[line];
            // Вычисляем колонку по реальной ширине текста с учётом горизонтального скролла
            this.ctx.font = this.font;
            const clickX = x + this.scrollOffsetX;
            let col = 0;
            let accWidth = 0;
            for (let i = 0; i < lineText.length; i++) {
                const w = this.ctx.measureText(lineText[i]).width;
                if (accWidth + w / 2 >= clickX) break;
                accWidth += w;
                col = i + 1;
            }

            this.cursorPos = 0;
            for (let i = 0; i < line; i++) {
                this.cursorPos += lines[i].length + 1;
            }
            this.cursorPos += Math.min(col, lineText.length);
        }

        this.ensureCursorVisible();
        this.render();
    }

    handleKeyDown(e) {
        const lines = this.code.split('\n');
        let line = 0;
        let col = 0;
        let pos = 0;

        for (let i = 0; i < lines.length; i++) {
            if (pos + lines[i].length >= this.cursorPos) {
                line = i;
                col = this.cursorPos - pos;
                break;
            }
            pos += lines[i].length + 1;
        }

        switch (e.key) {
            case 'ArrowUp':
                if (line > 0) {
                    this.cursorPos = pos - lines[line - 1].length - 1 + Math.min(col, lines[line - 1].length);
                }
                e.preventDefault();
                break;
            case 'ArrowDown':
                if (line < lines.length - 1) {
                    this.cursorPos = pos + lines[line].length + 1 + Math.min(col, lines[line + 1].length);
                }
                e.preventDefault();
                break;
            case 'ArrowLeft':
                if (this.cursorPos > 0) {
                    this.cursorPos--;
                }
                e.preventDefault();
                break;
            case 'ArrowRight':
                if (this.cursorPos < this.code.length) {
                    this.cursorPos++;
                }
                e.preventDefault();
                break;
            case 'Backspace':
                if (this.cursorPos > 0) {
                    this.code = this.code.slice(0, this.cursorPos - 1) + this.code.slice(this.cursorPos);
                    this.cursorPos--;
                    this.textarea.value = this.code;
                }
                e.preventDefault();
                break;
            case 'Delete':
                if (this.cursorPos < this.code.length) {
                    this.code = this.code.slice(0, this.cursorPos) + this.code.slice(this.cursorPos + 1);
                    this.textarea.value = this.code;
                }
                e.preventDefault();
                break;
            case 'Enter':
                this.code = this.code.slice(0, this.cursorPos) + '\n' + this.code.slice(this.cursorPos);
                this.cursorPos++;
                this.textarea.value = this.code;
                e.preventDefault();
                break;
            case 'Tab':
                this.code = this.code.slice(0, this.cursorPos) + '    ' + this.code.slice(this.cursorPos);
                this.cursorPos += 4;
                this.textarea.value = this.code;
                e.preventDefault();
                break;
            default:
                if (e.key.length === 1) {
                    this.code = this.code.slice(0, this.cursorPos) + e.key + this.code.slice(this.cursorPos);
                    this.cursorPos++;
                    this.textarea.value = this.code;
                }
                break;
        }

        // Автоскролл к курсору после любого изменения/навигации
        this.ensureCursorVisible();
        this.render();
    }

    tokenizeLine(line) {
        const tokens = [];
        let i = 0;

        while (i < line.length) {
            // Comments
            if (line.slice(i, i + 2) === '//') {
                tokens.push({ text: line.slice(i), type: 'comment' });
                break;
            }

            // Strings
            if (line[i] === '"') {
                let j = i + 1;
                while (j < line.length && line[j] !== '"') {
                    if (line[j] === '\\') j++;
                    j++;
                }
                tokens.push({ text: line.slice(i, j + 1), type: 'string' });
                i = j + 1;
                continue;
            }

            // Numbers
            if (/\d/.test(line[i])) {
                let j = i;
                while (j < line.length && /[\d.]/.test(line[j])) j++;
                tokens.push({ text: line.slice(i, j), type: 'number' });
                i = j;
                continue;
            }

            // Identifiers and keywords
            if (/[a-zA-Z_]/.test(line[i])) {
                let j = i;
                while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
                const word = line.slice(i, j);

                if (this.keywords.has(word)) {
                    tokens.push({ text: word, type: 'keyword' });
                } else if (this.types.has(word)) {
                    tokens.push({ text: word, type: 'type' });
                } else if (this.builtins.has(word)) {
                    tokens.push({ text: word, type: 'builtin' });
                } else {
                    tokens.push({ text: word, type: 'variable' });
                }

                i = j;
                continue;
            }

            // Operators
            if (/[+\-*/=<>!&|]/.test(line[i])) {
                let j = i;
                while (j < line.length && /[+\-*/=<>!&|]/.test(line[j])) j++;
                tokens.push({ text: line.slice(i, j), type: 'operator' });
                i = j;
                continue;
            }

            // Whitespace
            if (/\s/.test(line[i])) {
                let j = i;
                while (j < line.length && /\s/.test(line[j])) j++;
                tokens.push({ text: line.slice(i, j), type: 'text' });
                i = j;
                continue;
            }

            // Other characters
            tokens.push({ text: line[i], type: 'text' });
            i++;
        }

        return tokens;
    }

    render() {
        this.ctx.fillStyle = this.theme.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.font = this.font;
        this.ctx.textBaseline = 'top';

        const lines = this.code.split('\n');
        const startLine = Math.floor(this.scrollOffset / this.lineHeight);
        const endLine = Math.min(startLine + Math.ceil(this.canvas.height / this.lineHeight), lines.length);

        // Область отрисовки текста (без скроллбаров)
        const textAreaWidth = this.canvas.width - this.scrollbarWidth;

        // Клиппинг, чтобы текст не залезал под скроллбар
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, textAreaWidth, this.canvas.height);
        this.ctx.clip();

        for (let i = startLine; i < endLine; i++) {
            const y = (i - startLine) * this.lineHeight;
            const tokens = this.tokenizeLine(lines[i]);
            let x = -this.scrollOffsetX;

            for (const token of tokens) {
                this.ctx.fillStyle = this.theme[token.type] || this.theme.text;
                this.ctx.fillText(token.text, x, y);
                x += this.ctx.measureText(token.text).width;
            }
        }

        // Render cursor
        let line = 0;
        let col = 0;
        let pos = 0;
        const codeLines = this.code.split('\n');

        for (let i = 0; i < codeLines.length; i++) {
            if (pos + codeLines[i].length >= this.cursorPos) {
                line = i;
                col = this.cursorPos - pos;
                break;
            }
            pos += codeLines[i].length + 1;
        }

        if (line >= startLine && line < endLine) {
            const cursorY = (line - startLine) * this.lineHeight;
            const cursorX = this.ctx.measureText(codeLines[line].slice(0, col)).width - this.scrollOffsetX;

            this.ctx.fillStyle = this.theme.cursor;
            this.ctx.fillRect(cursorX, cursorY, 2, this.lineHeight);
        }

        this.ctx.restore();

        // Отрисовка скроллбаров
        this.renderScrollbars();
    }

    // Отрисовка вертикального и горизонтального скроллбаров
    renderScrollbars() {
        const maxScroll = this.getMaxScroll();
        const maxScrollX = this.getMaxScrollX();

        // Вертикальный скроллбар
        if (maxScroll > 0) {
            const trackX = this.canvas.width - this.scrollbarWidth;
            const trackHeight = this.canvas.height;
            const thumbHeight = Math.max(30, trackHeight * (this.canvas.height / (this.canvas.height + maxScroll)));
            const thumbY = (this.scrollOffset / maxScroll) * (trackHeight - thumbHeight);

            // Трек
            this.ctx.fillStyle = '#2d2d30';
            this.ctx.fillRect(trackX, 0, this.scrollbarWidth, trackHeight);

            // Ползунок
            this.ctx.fillStyle = this.scrollbarDragging ? '#5a5a5a' : '#424242';
            this.ctx.fillRect(trackX + 1, thumbY, this.scrollbarWidth - 2, thumbHeight);
        }

        // Горизонтальный скроллбар
        if (maxScrollX > 0) {
            const trackY = this.canvas.height - this.scrollbarWidth;
            const trackWidth = this.canvas.width - this.scrollbarWidth;
            const thumbWidth = Math.max(30, trackWidth * (trackWidth / (trackWidth + maxScrollX)));
            const thumbX = (this.scrollOffsetX / maxScrollX) * (trackWidth - thumbWidth);

            // Трек
            this.ctx.fillStyle = '#2d2d30';
            this.ctx.fillRect(0, trackY, trackWidth, this.scrollbarWidth);

            // Ползунок
            this.ctx.fillStyle = '#424242';
            this.ctx.fillRect(thumbX, trackY + 1, thumbWidth, this.scrollbarWidth - 2);
        }
    }
}
