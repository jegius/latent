// views/toolbar-view.js — слой отображения тулбара.
// Единственная ответственность: привязка событий кнопок тулбара.
// Не содержит бизнес-логики. Выбор примеров перенесён в меню (File → Examples).

export class ToolbarView {
    constructor() {
        this.compileBtn = document.getElementById('compile-btn');
        this.compileAIBtn = document.getElementById('compile-ai-btn');
        this.checkBtn = document.getElementById('check-btn');
        this.shareBtn = document.getElementById('share-btn');
        this.hotReloadToggle = document.getElementById('hot-reload-toggle');
        this.buildWasmBtn = document.getElementById('build-wasm-btn');
        this.newFileBtn = document.getElementById('new-file-btn');
    }

    /**
     * @param {() => void} handler
     */
    onCompile(handler) {
        this.compileBtn.addEventListener('click', handler);
    }

    /**
     * @param {() => void} handler
     */
    onCompileWithAI(handler) {
        this.compileAIBtn.addEventListener('click', handler);
    }

    /**
     * @param {() => void} handler
     */
    onCheckSyntax(handler) {
        this.checkBtn.addEventListener('click', handler);
    }

    /**
     * @param {() => void} handler
     */
    onShare(handler) {
        if (this.shareBtn) this.shareBtn.addEventListener('click', handler);
    }

    /**
     * @param {() => void} handler
     */
    onBuildWasm(handler) {
        if (this.buildWasmBtn) this.buildWasmBtn.addEventListener('click', handler);
    }

    /**
     * @param {() => void} handler
     */
    onNewFile(handler) {
        if (this.newFileBtn) this.newFileBtn.addEventListener('click', handler);
    }

    /**
     * Привязывает обработчик переключателя автоперезапуска.
     * @param {(enabled: boolean) => void} handler
     */
    onHotReloadToggle(handler) {
        if (this.hotReloadToggle) {
            this.hotReloadToggle.addEventListener('change', () => {
                handler(this.hotReloadToggle.checked);
            });
        }
    }
}