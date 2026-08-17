// main.js - Latent IDE with Canvas Editor

import { compile, checkSyntax } from './compiler-loader.js';
import { LatentRuntime } from './runtime.js';

class CanvasEditor {
    constructor(canvasId, textareaId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.textarea = document.getElementById(textareaId);
        this.code = '';
        this.cursorPos = 0;
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.scrollOffset = 0;
        this.lineHeight = 20;
        this.charWidth = 8;
        this.font = '14px "Fira Code", "Cascadia Code", monospace';
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

        this.render();
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

        const line = Math.floor(y / this.lineHeight) + Math.floor(this.scrollOffset / this.lineHeight);
        const col = Math.floor(x / this.charWidth);

        const lines = this.code.split('\n');
        if (line < lines.length) {
            const lineText = lines[line];
            this.cursorPos = 0;
            for (let i = 0; i < line; i++) {
                this.cursorPos += lines[i].length + 1;
            }
            this.cursorPos += Math.min(col, lineText.length);
        }

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

        for (let i = startLine; i < endLine; i++) {
            const y = (i - startLine) * this.lineHeight;
            const tokens = this.tokenizeLine(lines[i]);
            let x = 0;

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
            const cursorX = this.ctx.measureText(codeLines[line].slice(0, col)).width;

            this.ctx.fillStyle = this.theme.cursor;
            this.ctx.fillRect(cursorX, cursorY, 2, this.lineHeight);
        }
    }
}

class LatentIDE {
    constructor() {
        this.editor = null;
        this.runtime = new LatentRuntime();
        this.init();
    }

    init() {
        this.editor = new CanvasEditor('editor-canvas', 'editor');

        // Set example code
        this.editor.setCode(`// Welcome to Latent IDE!

fn main() -> int {
    let ch = channel<int>();
    spawn {
        ch <- 42;
    };
    let x = <-ch;
    return x;
}
`);

        // Button handlers
        document.getElementById('compile-btn').addEventListener('click', () => {
            this.compileAndRun();
        });

        document.getElementById('check-btn').addEventListener('click', () => {
            this.checkSyntax();
        });

        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');
    }

    async compileAndRun() {
        const source = this.editor.getCode();
        const status = document.getElementById('status');
        const output = document.getElementById('console-output');

        try {
            status.textContent = 'Compiling...';
            output.textContent = '';

            const wasmBytes = await compile(source);

            status.textContent = 'Running...';

            await this.runtime.load(wasmBytes);

            const originalLog = console.log;
            console.log = (...args) => {
                output.textContent += args.join(' ') + '\n';
                originalLog(...args);
            };

            const result = this.runtime.callMain();

            console.log = originalLog;

            output.textContent += `\nResult: ${result}\n`;
            status.textContent = 'Done';

        } catch (e) {
            status.textContent = 'Error';
            output.textContent = `Error: ${e.message}\n`;
        }
    }

    async checkSyntax() {
        const source = this.editor.getCode();
        const status = document.getElementById('status');

        try {
            await checkSyntax(source);
            status.textContent = '✓ Syntax OK';
            status.style.color = 'green';
        } catch (e) {
            status.textContent = `✗ ${e.message}`;
            status.style.color = 'red';
        }
    }
}

// Start IDE
new LatentIDE();
