// hot-reload.js — hot reload для Latent IDE

export class HotReload {
    constructor(ide) {
        this.ide = ide;
        this.enabled = false;
        this.timeout = null;
    }

    enable() {
        this.enabled = true;
        this.ide.editor.on('change', () => {
            if (!this.enabled) return;

            clearTimeout(this.timeout);
            this.timeout = setTimeout(() => {
                this.ide.compileAndRun();
            }, 1000); // 1 секунда debounce
        });
    }

    disable() {
        this.enabled = false;
        clearTimeout(this.timeout);
    }
}
