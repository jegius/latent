// views/menubar-view.js — верхнее меню IDE (File/Edit/View/Run/AI/Help).
// Единственная ответственность: рендер выпадающих меню и диспетчеризация действий.
// Не содержит бизнес-логики: пункты лишь вызывают зарегистрированные обработчики.

/**
 * @typedef {Object} MenuItem
 * @property {string} label
 * @property {string} [shortcut]
 * @property {string} [action] — ключ действия; если нет children
 * @property {MenuItem[]} [children] — вложенное подменю
 */

export class MenubarView {
    /**
     * @param {string} rootSelector — селектор контейнера меню (обычно '.menubar')
     */
    constructor(rootSelector = '.menubar') {
        this.root = document.querySelector(rootSelector);
        this.handlers = new Map();
        this.openMenu = null;
    }

    /**
     * Регистрирует обработчик действия.
     * @param {string} action
     * @param {() => void} handler
     */
    on(action, handler) {
        this.handlers.set(action, handler);
    }

    /**
     * Строит меню из спецификации и заменяет прежние .menubar-item.
     * @param {Array<{label: string, items: MenuItem[]}>} menus
     */
    render(menus) {
        if (!this.root) return;
        // Удаляем статические пункты меню
        this.root.querySelectorAll('.menubar-item').forEach(el => el.remove());

        const spacer = this.root.querySelector('.menubar-spacer');
        for (const menu of menus) {
            const item = this.buildTopItem(menu);
            this.root.insertBefore(item, spacer);
        }
    }

    buildTopItem(menu) {
        const item = document.createElement('span');
        item.className = 'menubar-item';
        item.textContent = menu.label;

        const dropdown = document.createElement('div');
        dropdown.className = 'menubar-dropdown';
        for (const child of menu.items) {
            dropdown.appendChild(this.buildEntry(child));
        }

        item.appendChild(dropdown);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle(item);
        });
        item.addEventListener('mouseenter', () => {
            if (this.openMenu && this.openMenu !== item) this.toggle(item);
        });
        return item;
    }

    buildEntry(entry) {
        if (entry.children && entry.children.length) {
            return this.buildSubmenu(entry);
        }
        const row = document.createElement('div');
        row.className = 'menubar-entry';
        row.dataset.action = entry.action || '';

        const label = document.createElement('span');
        label.className = 'menubar-entry-label';
        label.textContent = entry.label;
        row.appendChild(label);

        if (entry.shortcut) {
            const sc = document.createElement('span');
            sc.className = 'menubar-entry-shortcut';
            sc.textContent = entry.shortcut;
            row.appendChild(sc);
        }

        row.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeAll();
            const handler = this.handlers.get(entry.action);
            if (handler) handler();
        });
        return row;
    }

    buildSubmenu(entry) {
        const row = document.createElement('div');
        row.className = 'menubar-entry has-submenu';

        const label = document.createElement('span');
        label.className = 'menubar-entry-label';
        label.textContent = entry.label;
        row.appendChild(label);

        const arrow = document.createElement('span');
        arrow.className = 'menubar-entry-arrow';
        arrow.textContent = '›';
        row.appendChild(arrow);

        const sub = document.createElement('div');
        sub.className = 'menubar-submenu';
        for (const child of entry.children) {
            sub.appendChild(this.buildEntry(child));
        }
        row.appendChild(sub);
        return row;
    }

    toggle(item) {
        if (this.openMenu === item) {
            this.closeAll();
            return;
        }
        this.closeAll();
        item.classList.add('open');
        this.openMenu = item;
    }

    closeAll() {
        this.root.querySelectorAll('.menubar-item.open')
            .forEach(el => el.classList.remove('open'));
        this.openMenu = null;
    }

    /** Закрывает меню по клику в любом другом месте документа. */
    installGlobalClose() {
        document.addEventListener('click', () => this.closeAll());
    }
}