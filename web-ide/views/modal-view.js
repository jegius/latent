// views/modal-view.js — модальные окна Latent IDE на основе «портала».
//
// Портал: DOM модалки создаётся не внутри дерева IDE (где `overflow:hidden`
// и z-index предков обрезали бы её), а в отдельном корне `#portal-root`,
// прикреплённом к `document.body`. Это гарантирует, что оверлей и диалог
// рисуются поверх всего интерфейса независимо от вложенности.
//
// Публичный API — промис-ориентированный:
//   Modal.alert({...})   -> Promise<void>
//   Modal.confirm({...}) -> Promise<boolean>
//   Modal.prompt({...})  -> Promise<string|null>
//
// Заменяет браузерные window.confirm / window.prompt нормальной вёрсткой.

/** Селектор контейнера-портала. */
const PORTAL_ID = 'portal-root';

/**
 * Возвращает (создавая при необходимости) корневой узел портала.
 * @returns {HTMLElement}
 */
function getPortalRoot() {
    let root = document.getElementById(PORTAL_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = PORTAL_ID;
        root.className = 'portal-root';
        document.body.appendChild(root);
    }
    return root;
}

/**
 * Строит DOM диалога и возвращает управляющий объект.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.message]
 * @param {'alert'|'confirm'|'prompt'} opts.kind
 * @param {string} [opts.inputValue]
 * @param {string} [opts.placeholder]
 * @param {string} [opts.confirmText]
 * @param {string} [opts.cancelText]
 * @param {boolean} [opts.danger]
 * @param {(value: string) => void} [opts.resolve]
 */
function buildDialog(opts) {
    const root = getPortalRoot();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog' + (opts.danger ? ' modal-danger' : '');
    dialog.setAttribute('role', opts.kind === 'alert' ? 'alertdialog' : 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (opts.title) dialog.setAttribute('aria-label', opts.title);

    // --- Заголовок (с иконкой по типу) ---
    const header = document.createElement('div');
    header.className = 'modal-header';

    const icon = document.createElement('span');
    icon.className = 'modal-icon';
    icon.textContent = opts.danger ? '⚠' : (opts.kind === 'prompt' ? '✎' : 'ⓘ');
    header.appendChild(icon);

    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = opts.title || '';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.textContent = '✕';
    header.appendChild(closeBtn);

    dialog.appendChild(header);

    // --- Тело ---
    const body = document.createElement('div');
    body.className = 'modal-body';

    if (opts.message) {
        const msg = document.createElement('div');
        msg.className = 'modal-message';
        msg.textContent = opts.message;
        body.appendChild(msg);
    }

    /** @type {HTMLInputElement|null} */
    let input = null;
    if (opts.kind === 'prompt') {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'modal-input';
        input.value = opts.inputValue || '';
        if (opts.placeholder) input.placeholder = opts.placeholder;
        body.appendChild(input);
    }
    dialog.appendChild(body);

    // --- Кнопки ---
    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    let cancelBtn = null;
    if (opts.kind !== 'alert') {
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'modal-btn';
        cancelBtn.textContent = opts.cancelText || 'Отмена';
        footer.appendChild(cancelBtn);
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'modal-btn modal-btn-primary';
    confirmBtn.textContent = opts.confirmText || (opts.kind === 'alert' ? 'OK' : 'OK');
    footer.appendChild(confirmBtn);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    root.appendChild(overlay);

    return { overlay, dialog, input, confirmBtn, cancelBtn, closeBtn };
}

/**
 * Открывает модальное окно и возвращает промис с результатом.
 * @param {Object} opts
 * @returns {Promise<any>}
 */
function openModal(opts) {
    return new Promise((resolve) => {
        const ui = buildDialog(opts);

        const previouslyFocused = document.activeElement;

        const finish = (result) => {
            document.removeEventListener('keydown', onKeyDown, true);
            ui.overlay.classList.add('modal-closing');
            // Даём анимации закрытия завершиться, затем убираем DOM портала.
            window.setTimeout(() => {
                ui.overlay.remove();
                const root = document.getElementById(PORTAL_ID);
                if (root && root.childElementCount === 0) root.remove();
            }, 120);
            if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
            resolve(result);
        };

        const confirm = () => {
            if (opts.kind === 'prompt') finish(ui.input ? ui.input.value : '');
            else if (opts.kind === 'confirm') finish(true);
            else finish(undefined);
        };
        const cancel = () => {
            if (opts.kind === 'prompt') finish(null);
            else if (opts.kind === 'confirm') finish(false);
            else finish(undefined);
        };

        ui.confirmBtn.addEventListener('click', confirm);
        if (ui.cancelBtn) ui.cancelBtn.addEventListener('click', cancel);
        ui.closeBtn.addEventListener('click', cancel);

        // Клик по оверлею (но не по диалогу) — отмена
        ui.overlay.addEventListener('mousedown', (e) => {
            if (e.target === ui.overlay) cancel();
        });

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            } else if (e.key === 'Enter') {
                // Для prompt Enter подтверждает; Shift+Enter — перенос не нужен
                e.preventDefault();
                confirm();
            } else if (e.key === 'Tab') {
                // Простейшая ловушка фокуса внутри диалога
                const focusables = [ui.input, ui.cancelBtn, ui.confirmBtn, ui.closeBtn]
                    .filter(Boolean);
                if (focusables.length === 0) return;
                const idx = focusables.indexOf(document.activeElement);
                const next = e.shiftKey
                    ? focusables[(idx - 1 + focusables.length) % focusables.length]
                    : focusables[(idx + 1) % focusables.length];
                e.preventDefault();
                next.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);

        // Фокус: поле ввода для prompt, иначе основная кнопка
        window.setTimeout(() => {
            if (ui.input) {
                ui.input.focus();
                if (opts.selectAll !== false) ui.input.select();
            } else {
                ui.confirmBtn.focus();
            }
        }, 0);
    });
}

/** Публичный фасад модальных окон. */
export const Modal = {
    /**
     * Информационное окно с одной кнопкой.
     * @returns {Promise<void>}
     */
    alert(opts) {
        const o = typeof opts === 'string' ? { message: opts } : (opts || {});
        return openModal({ kind: 'alert', title: o.title || 'Latent IDE', ...o });
    },

    /**
     * Окно подтверждения.
     * @returns {Promise<boolean>}
     */
    confirm(opts) {
        const o = typeof opts === 'string' ? { message: opts } : (opts || {});
        return openModal({ kind: 'confirm', title: o.title || 'Подтверждение', ...o });
    },

    /**
     * Окно ввода строки. Возвращает введённое значение или null при отмене.
     * @returns {Promise<string|null>}
     */
    prompt(opts) {
        const o = typeof opts === 'string' ? { message: opts } : (opts || {});
        return openModal({ kind: 'prompt', title: o.title || 'Ввод', ...o });
    },
};