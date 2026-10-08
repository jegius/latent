// views/file-tree-view.js — панель иерархии файлов проекта.
// Отвечает только за DOM: рендер дерева, кнопки создания/удаления/переименования.
// Бизнес-логику хранит WorkspaceService. Диалоги — через портальные модалки.

import { Modal } from './modal-view.js';
import { EXAMPLE_GROUPS } from '../examples.js';

export class FileTreeView {
    constructor(rootId) {
        this.root = document.getElementById(rootId);
        this.exampleRoot = document.getElementById('example-tree');
        this.folderEl = document.getElementById('examples-folder');
        this.countEl = document.getElementById('examples-count');
        this.examplesCollapsed = false;
        this.handlers = {
            select: () => {},
            create: () => {},
            delete: () => {},
            rename: () => {},
            selectExample: () => {},
        };
        if (this.folderEl) {
            this.folderEl.addEventListener('click', () => this.toggleExamples());
        }
    }

    onClick(kind, handler) {
        this.handlers[kind] = handler;
    }

    /** Сворачивает/разворачивает папку examples. */
    toggleExamples() {
        this.examplesCollapsed = !this.examplesCollapsed;
        if (this.folderEl) {
            this.folderEl.classList.toggle('collapsed', this.examplesCollapsed);
        }
        if (this.exampleRoot) {
            this.exampleRoot.style.display = this.examplesCollapsed ? 'none' : '';
        }
    }

    /**
     * Рендерит папку examples/ со списком примеров, сгруппированных по темам.
     * @param {Array<import('../examples.js').Example>} examples
     */
    renderExamples(examples) {
        if (!this.exampleRoot) return;
        this.exampleRoot.innerHTML = '';
        if (this.countEl) this.countEl.textContent = String(examples.length);

        const byGroup = new Map();
        for (const ex of examples) {
            const group = ex.group || 'Misc';
            if (!byGroup.has(group)) byGroup.set(group, []);
            byGroup.get(group).push(ex);
        }

        // Порядок групп — как в EXAMPLE_GROUPS, незнакомые уходят в конец.
        const ordered = [
            ...EXAMPLE_GROUPS.filter(g => byGroup.has(g)),
            ...[...byGroup.keys()].filter(g => !EXAMPLE_GROUPS.includes(g)),
        ];

        for (const group of ordered) {
            const header = document.createElement('div');
            header.className = 'tree-group';
            header.textContent = group;
            this.exampleRoot.appendChild(header);

            for (const ex of byGroup.get(group)) {
                const row = document.createElement('div');
                row.className = 'tree-file tree-example';
                row.dataset.id = ex.id;
                row.title = ex.description;

                const icon = document.createElement('span');
                icon.className = 'tree-file-icon';
                icon.textContent = 'λ';

                const label = document.createElement('span');
                label.className = 'tree-file-name';
                label.textContent = ex.title;

                row.appendChild(icon);
                row.appendChild(label);

                if (ex.needsAI) {
                    const badge = document.createElement('span');
                    badge.className = 'tree-example-ai';
                    badge.textContent = 'AI';
                    badge.title = 'Запускать через «Run with AI»';
                    row.appendChild(badge);
                }

                row.addEventListener('click', () => this.handlers.selectExample(ex.id));
                this.exampleRoot.appendChild(row);
            }
        }

        this.exampleRoot.style.display = this.examplesCollapsed ? 'none' : '';
    }

    /**
     * Рендерит дерево файлов.
     * @param {Array<{id:string,name:string}>} files
     * @param {string} activeId
     */
    render(files, activeId) {
        if (!this.root) return;
        this.root.innerHTML = '';

        if (files.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'tree-empty';
            empty.textContent = 'Нет файлов';
            this.root.appendChild(empty);
            return;
        }

        for (const file of files) {
            const row = document.createElement('div');
            row.className = 'tree-file' + (file.id === activeId ? ' active' : '');
            row.dataset.id = file.id;
            row.title = file.name;

            const icon = document.createElement('span');
            icon.className = 'tree-file-icon';
            icon.textContent = 'λ'; // Latent-файл

            const label = document.createElement('span');
            label.className = 'tree-file-name';
            label.textContent = file.name;

            const actions = document.createElement('span');
            actions.className = 'tree-file-actions';

            const renameBtn = document.createElement('button');
            renameBtn.className = 'tree-action';
            renameBtn.textContent = '✎';
            renameBtn.title = 'Переименовать';
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptRename(file);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'tree-action';
            delBtn.textContent = '🗑';
            delBtn.title = 'Удалить';
            delBtn.disabled = files.length <= 1;
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handlers.delete(file.id);
            });

            actions.appendChild(renameBtn);
            actions.appendChild(delBtn);

            row.appendChild(icon);
            row.appendChild(label);
            row.appendChild(actions);
            row.addEventListener('click', () => this.handlers.select(file.id));

            this.root.appendChild(row);
        }
    }

    promptRename(file) {
        Modal.prompt({
            title: 'Переименование файла',
            message: 'Новое имя файла:',
            inputValue: file.name,
        }).then((next) => {
            if (next && next.trim()) {
                this.handlers.rename(file.id, next.trim());
            }
        });
    }
}