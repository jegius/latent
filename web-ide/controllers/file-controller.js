// controllers/file-controller.js — операции с файлами рабочего пространства.
// Единственная ответственность: дерево файлов, табы редактора, статус-бар.
// Методы применяются к прототипу LatentIDEController (миксин).

import { Modal } from '../views/modal-view.js';

export const fileControllerMethods = {
    refreshFileTree() {
        this.fileTreeView.render(this.workspace.files, this.workspace.activeId);
        if (this.examples && this.examples.length) {
            this.fileTreeView.renderExamples(this.examples);
        }
        this.refreshEditorTabs();
        this.refreshStatusBar();
    },

    refreshEditorTabs() {
        const host = document.getElementById('editor-tabs');
        if (!host) return;
        host.innerHTML = '';
        for (const file of this.workspace.files) {
            const tab = document.createElement('div');
            tab.className = 'editor-tab' + (file.id === this.workspace.activeId ? ' active' : '');
            tab.textContent = file.name;
            tab.dataset.id = file.id;
            tab.title = `${file.name} — средняя кнопка мыши закрывает`;
            tab.addEventListener('click', () => this.handleSelectFile(file.id));
            // Закрытие таба средней кнопкой мыши (как в браузере/IDE).
            tab.addEventListener('mousedown', (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    this.handleDeleteFile(file.id);
                }
            });
            // Гасим автоскролл по средней кнопке на уровне таба.
            tab.addEventListener('auxclick', (e) => {
                if (e.button === 1) e.preventDefault();
            });
            host.appendChild(tab);
        }
    },

    refreshStatusBar() {
        const active = this.workspace.getActive();
        const fileEl = document.getElementById('status-file');
        if (fileEl && active) fileEl.textContent = active.name;
        this.updateCursorStatus();
    },

    updateCursorStatus() {
        const el = document.getElementById('status-cursor');
        if (!el) return;
        const { line, col } = this.editor.posToLineCol(this.editor.cursorPos);
        el.textContent = `Ln ${line + 1}, Col ${col + 1}`;
    },

    handleSelectFile(id) {
        this.workspace.setActive(id);
        const file = this.workspace.getActive();
        if (file) this.editor.setCode(file.code);
        this.refreshFileTree();
    },

    async handleNewFile() {
        const name = await Modal.prompt({
            title: 'Новый файл',
            message: 'Имя нового файла Latent:',
            inputValue: 'untitled.lat',
            confirmText: 'Создать',
        });
        if (name === null) return;
        const file = this.workspace.createFile(name, '// Новый файл Latent\nfn main() {\n    print("hello");\n}\n');
        this.editor.setCode(file.code);
        this.refreshFileTree();
        this.outputView.setStatus(`Создан файл ${file.name}`, 'info');
    },

    async handleDeleteFile(id) {
        const file = this.workspace.getFile(id);
        if (!file) return;
        const ok = await Modal.confirm({
            title: 'Удаление файла',
            message: `Удалить «${file.name}»? Это действие нельзя отменить.`,
            confirmText: 'Удалить',
            danger: true,
        });
        if (!ok) return;
        if (!this.workspace.deleteFile(id)) {
            this.outputView.setStatus('Нельзя удалить последний файл', 'error');
            return;
        }
        this.editor.setCode(this.workspace.getActiveCode());
        this.refreshFileTree();
    },

    handleRenameFile(id, name) {
        this.workspace.renameFile(id, name);
        this.refreshFileTree();
    },
};