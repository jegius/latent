// views/toolbar-view.js — слой отображения тулбара.
// Отвечает только за привязку событий кнопок и селектора примеров.
// Не содержит бизнес-логики.

export class ToolbarView {
    constructor() {
        this.compileBtn = document.getElementById('compile-btn');
        this.compileAIBtn = document.getElementById('compile-ai-btn');
        this.checkBtn = document.getElementById('check-btn');
        this.examplesSelect = document.getElementById('examples-select');
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
     * Заполняет выпадающий список примеров.
     * @param {Array<{id: string, title: string}>} examples
     */
    populateExamples(examples) {
        // Оставляем только placeholder-пункт
        this.examplesSelect.length = 1;
        for (const ex of examples) {
            const option = document.createElement('option');
            option.value = ex.id;
            option.textContent = ex.title;
            this.examplesSelect.appendChild(option);
        }
    }

    /**
     * Привязывает обработчик выбора примера.
     * @param {(exampleId: string) => void} handler
     */
    onExampleSelected(handler) {
        this.examplesSelect.addEventListener('change', () => {
            const id = this.examplesSelect.value;
            if (id) {
                handler(id);
                // Сбрасываем выбор, чтобы повторный клик по тому же примеру тоже срабатывал
                this.examplesSelect.value = '';
            }
        });
    }
}
