// hot-reload.js — «hot reload» для Latent IDE.
//
// Честная терминология (см. §6.4 статьи): это НЕ hot-swap живого объекта, а
// дебаунсированный автоперезапуск интерпретатора. Что сохраняется между
// перезапусками: кэш AI (живёт в compiler-loader) и позиция курсора/скролла
// редактора (её не трогаем — перерисовка идёт тем же кодом).

/**
 * Дебаунсер: вызывает fn не чаще, чем раз в delay мс тишины.
 * @param {() => void} fn
 * @param {number} delay
 * @returns {{run: () => void, cancel: () => void, flush: () => void}}
 */
export function createDebouncer(fn, delay = 350) {
    let timeout = null;
    let pending = false;

    const run = () => {
        pending = true;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            pending = false;
            timeout = null;
            fn();
        }, delay);
    };

    const cancel = () => {
        clearTimeout(timeout);
        timeout = null;
        pending = false;
    };

    const flush = () => {
        if (pending) {
            clearTimeout(timeout);
            timeout = null;
            pending = false;
            fn();
        }
    };

    return { run, cancel, flush };
}

export class HotReload {
    /**
     * @param {object} opts
     * @param {() => void} opts.onReload — что перезапускать (обычно compileAndRun)
     * @param {number} [opts.delay] — задержка дебаунса (по умолчанию 350 мс)
     */
    constructor(opts = {}) {
        this.onReload = opts.onReload || (() => {});
        this.enabled = false;
        this.debouncer = createDebouncer(() => {
            if (this.enabled) this.onReload();
        }, opts.delay != null ? opts.delay : 350);
    }

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
        this.debouncer.cancel();
    }

    toggle(enabled) {
        this.enabled = enabled !== undefined ? enabled : !this.enabled;
        if (!this.enabled) this.debouncer.cancel();
        return this.enabled;
    }

    /** Вызывается редактором на каждое изменение кода. */
    notifyChange() {
        if (!this.enabled) return;
        this.debouncer.run();
    }
}