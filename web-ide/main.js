// main.js — точка входа Latent IDE

import { compile, checkSyntax } from './compiler-loader.js';
import { LatentRuntime } from './runtime.js';
import { setupAutocomplete } from './autocomplete.js';
import { HotReload } from './hot-reload.js';

class LatentIDE {
    constructor() {
        this.editor = null;
        this.runtime = new LatentRuntime();
        this.hotReload = new HotReload(this);
        this.init();
    }

    init() {
        // Инициализируем CodeMirror
        this.editor = CodeMirror.fromTextArea(document.getElementById('editor'), {
            mode: 'latent',
            lineNumbers: true,
            theme: 'default',
            indentUnit: 4,
            autofocus: true
        });

        // Устанавливаем пример кода
        this.editor.setValue(`// Добро пожаловать в Latent IDE!

fn main() -> int {
    let x = 42;
    print(x);
    return x;
}
`);

        // Обработчики кнопок
        document.getElementById('compile-btn').addEventListener('click', () => {
            this.compileAndRun();
        });

        document.getElementById('check-btn').addEventListener('click', () => {
            this.checkSyntax();
        });

        // Hot reload при изменении кода (с debounce)
        let timeout;
        this.editor.on('change', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                this.checkSyntax();
            }, 500);
        });

        // Автодополнение
        setupAutocomplete(this.editor);

        // Табы
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }

    switchTab(tabName) {
        // Убираем active у всех табов
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Добавляем active выбранному табу
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');
    }

    async compileAndRun() {
        const source = this.editor.getValue();
        const status = document.getElementById('status');
        const output = document.getElementById('console-output');

        try {
            status.textContent = 'Compiling...';
            output.textContent = '';

            // Компилируем
            const wasmBytes = await compile(source);

            status.textContent = 'Running...';

            // Загружаем в runtime
            await this.runtime.load(wasmBytes);

            // Перехватываем console.log
            const originalLog = console.log;
            console.log = (...args) => {
                output.textContent += args.join(' ') + '\n';
                originalLog(...args);
            };

            // Выполняем
            const result = this.runtime.callMain();

            // Восстанавливаем console.log
            console.log = originalLog;

            output.textContent += `\nResult: ${result}\n`;
            status.textContent = 'Done';

        } catch (e) {
            status.textContent = 'Error';
            output.textContent = `Error: ${e.message}\n`;
        }
    }

    async checkSyntax() {
        const source = this.editor.getValue();
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

// Запускаем IDE
new LatentIDE();
